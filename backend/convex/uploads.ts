import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const generateUploadTicket = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const recordUpload = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");

    const existing = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique();

    if (existing) {
      if (existing.userId !== user._id) throw new Error("Upload not found");
      return;
    }

    await ctx.db.insert("uploads", {
      userId: user._id,
      storageId,
      createdAt: Date.now(),
    });
  },
});

export const commitUpload = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");

    const upload = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique();
    if (!upload || upload.userId !== user._id) {
      throw new Error("Upload not found");
    }

    const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
    if (!url) throw new Error("Upload not found");
    return { url };
  },
});
