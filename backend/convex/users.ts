import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const upsertFromAuth = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      // Only overwrite fields the caller actually provided, so a later sign-in
      // that omits a field (e.g. no name) doesn't wipe the stored value.
      const updates: { email?: string; name?: string; image?: string } = {};
      if (args.email !== undefined) updates.email = args.email;
      if (args.name !== undefined) updates.name = args.name;
      if (args.image !== undefined) updates.image = args.image;
      await ctx.db.patch(existing._id, updates);
      return;
    }

    await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: args.email,
      name: args.name,
      image: args.image,
      tier: "max",
      spentCreditsThisPeriod: 0,
      purchasedCredits: 0,
    });
  },
});
