export function ceilCredits(credits: number): number {
  return credits <= 0 ? 0 : Math.ceil(credits);
}

// Convex internal actions cap at ~10 min; leave buffer for submit + download + storage.
export const PROVIDER_POLL_INTERVAL_MS = 3_000;
export const PROVIDER_ACTION_TIMEOUT_MS = 480_000;
