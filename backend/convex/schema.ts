import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const tier = v.union(v.literal("none"), v.literal("pro"), v.literal("max"));

// Self-tagged client params (discriminated on `kind`); reused as the submit args validator.
export const generationParams = v.union(
  v.object({
    kind: v.literal("image"),
    prompt: v.string(),
    aspectRatio: v.string(),
    resolution: v.optional(v.string()),
    quality: v.optional(v.string()),
    imageURLs: v.optional(v.array(v.string())),
    numImages: v.number(),
  }),
  v.object({
    kind: v.literal("video"),
    prompt: v.string(),
    duration: v.number(),
    aspectRatio: v.string(),
    resolution: v.optional(v.string()),
    sourceVideoURL: v.optional(v.string()),
    startFrameURL: v.optional(v.string()),
    endFrameURL: v.optional(v.string()),
    referenceImageURLs: v.optional(v.array(v.string())),
    referenceVideoURLs: v.optional(v.array(v.string())),
    referenceAudioURLs: v.optional(v.array(v.string())),
    generateAudio: v.boolean(),
  }),
  v.object({
    kind: v.literal("audio"),
    prompt: v.string(),
    voice: v.optional(v.string()),
    lyrics: v.optional(v.string()),
    styleInstructions: v.optional(v.string()),
    instrumental: v.boolean(),
    durationSeconds: v.optional(v.number()),
    videoURL: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("upscale"),
    sourceURL: v.string(),
    durationSeconds: v.number(),
  }),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    tier,
    spentCreditsThisPeriod: v.number(),
    purchasedCredits: v.number(),
  }).index("by_clerk", ["clerkId"]),

  generations: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("video"),
      v.literal("image"),
      v.literal("audio"),
      v.literal("upscale"),
    ),
    model: v.string(),
    params: generationParams,
    projectId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    resultUrls: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
    costCredits: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  uploads: defineTable({
    userId: v.id("users"),
    storageId: v.string(),
    createdAt: v.number(),
  }).index("by_storage", ["storageId"]),
});
