import { action } from "./_generated/server";
import { v } from "convex/values";

export const send = action({
  args: {
    message: v.string(),
    mayContact: v.boolean(),
    appVersion: v.string(),
    osVersion: v.string(),
    email: v.optional(v.string()),
    screenshotPngBase64: v.optional(v.string()),
  },
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    // TODO(05): persist feedback to a table or forward to a real sink.
    return { ok: true };
  },
});
