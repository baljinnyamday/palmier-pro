import { query } from "./_generated/server";

const PERSONAL_BUDGET_CREDITS = 1_000_000;

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;

    return {
      user: {
        email: user.email,
        name: user.name,
        image: user.image,
        tier: "max" as const,
        currentPeriodEnd: undefined,
        cancelAtPeriodEnd: undefined,
        spentCreditsThisPeriod: user.spentCreditsThisPeriod ?? 0,
        purchasedCredits: user.purchasedCredits ?? 0,
      },
      plan: {
        tier: "max" as const,
        monthlyPriceUsd: 99,
        monthlyBudgetCredits: PERSONAL_BUDGET_CREDITS,
      },
    };
  },
});
