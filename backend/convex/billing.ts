import { action, query } from "./_generated/server";
import { v } from "convex/values";

export const listPlans = query({
  args: {},
  handler: async () => [
    {
      tier: "pro" as const,
      monthlyPriceUsd: 29,
      discountedMonthlyPriceUsd: undefined,
      monthlyBudgetCredits: 10_000,
    },
    {
      tier: "max" as const,
      monthlyPriceUsd: 99,
      discountedMonthlyPriceUsd: undefined,
      monthlyBudgetCredits: 100_000,
    },
  ],
});

export const createCheckoutSession = action({
  args: { tier: v.string() },
  handler: async () => {
    throw new Error("Billing not enabled");
  },
});

export const createTopOffCheckoutSession = action({
  args: { dollars: v.number() },
  handler: async () => {
    throw new Error("Billing not enabled");
  },
});

export const createPortalSession = action({
  args: {},
  handler: async () => {
    throw new Error("Billing not enabled");
  },
});
