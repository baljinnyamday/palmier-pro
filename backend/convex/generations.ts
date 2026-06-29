import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { assertModelAvailable } from "./providers/env";
import { routeToProvider } from "./providers/router";
import { GenerationParams, ProviderContext } from "./providers/types";
import { generationParams } from "./schema";
import { getCatalogEntry } from "./models";

// Convex internal actions cap at ~10 min; reclaim stale runners after limit + buffer.
const STALE_RUNNING_MS = 11 * 60 * 1000;

export const submit = mutation({
  args: {
    model: v.string(),
    params: generationParams,
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");

    const catalogEntry = getCatalogEntry(args.model);
    assertModelAvailable(args.model, catalogEntry?.displayName);

    const jobId = await ctx.db.insert("generations", {
      userId: user._id,
      kind: args.params.kind,
      model: args.model,
      params: args.params,
      projectId: args.projectId,
      status: "queued",
    });

    await ctx.scheduler.runAfter(0, internal.generations.process, { jobId });
    return { jobId };
  },
});

export const byId = query({
  args: { id: v.id("generations") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const job = await ctx.db.get(id);
    if (!job) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user || job.userId !== user._id) throw new Error("Not found");
    return job;
  },
});

export const claimForProcessing = internalMutation({
  args: { jobId: v.id("generations") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status === "succeeded" || job.status === "failed") {
      return { claimed: false as const };
    }
    if (job.status === "queued") {
      await ctx.db.patch(jobId, { status: "running", startedAt: Date.now() });
      const updated = await ctx.db.get(jobId);
      if (!updated) throw new Error("Job not found");
      return { claimed: true as const, job: updated };
    }
    if (job.status === "running") {
      const startedAt = job.startedAt ?? 0;
      if (Date.now() - startedAt < STALE_RUNNING_MS) {
        return { claimed: false as const };
      }
      await ctx.db.patch(jobId, { status: "running", startedAt: Date.now() });
      const updated = await ctx.db.get(jobId);
      if (!updated) throw new Error("Job not found");
      return { claimed: true as const, job: updated };
    }
    return { claimed: false as const };
  },
});

export const setSucceeded = internalMutation({
  args: {
    jobId: v.id("generations"),
    resultUrls: v.array(v.string()),
    costCredits: v.number(),
  },
  handler: async (ctx, { jobId, resultUrls, costCredits }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status === "succeeded") return;

    await ctx.db.patch(jobId, {
      status: "succeeded",
      resultUrls,
      costCredits,
      completedAt: Date.now(),
    });

    const user = await ctx.db.get(job.userId);
    if (user) {
      await ctx.db.patch(user._id, {
        spentCreditsThisPeriod: user.spentCreditsThisPeriod + costCredits,
      });
    }
  },
});

export const setFailed = internalMutation({
  args: {
    jobId: v.id("generations"),
    errorMessage: v.string(),
  },
  handler: async (ctx, { jobId, errorMessage }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status === "succeeded" || job.status === "failed") return;

    await ctx.db.patch(jobId, {
      status: "failed",
      errorMessage,
      completedAt: Date.now(),
    });
  },
});

export const process = internalAction({
  args: { jobId: v.id("generations") },
  handler: async (ctx, { jobId }) => {
    try {
      const claim = await ctx.runMutation(
        internal.generations.claimForProcessing,
        { jobId },
      );
      if (!claim.claimed) return;

      const storeBytes = async (bytes: ArrayBuffer, contentType: string) => {
        const blob = new Blob([bytes], { type: contentType });
        const storageId = await ctx.storage.store(blob);
        const storedUrl = await ctx.storage.getUrl(storageId);
        if (!storedUrl) throw new Error("Failed to resolve stored result URL");
        return storedUrl;
      };

      const { resultUrls, costCredits } = await routeToProvider(
        claim.job.model,
        claim.job.params as GenerationParams,
        {
          rehostUrl: async (url) => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(
                `Failed to download provider result (${response.status})`,
              );
            }
            const buffer = await response.arrayBuffer();
            return storeBytes(
              buffer,
              response.headers.get("content-type") ?? "application/octet-stream",
            );
          },
          storeBytes,
        },
      );
      await ctx.runMutation(internal.generations.setSucceeded, {
        jobId,
        resultUrls,
        costCredits,
      });
    } catch (err) {
      await ctx.runMutation(internal.generations.setFailed, {
        jobId,
        errorMessage: String(err),
      });
    }
  },
});
