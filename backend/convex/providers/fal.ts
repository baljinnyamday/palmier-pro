const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = DEFAULT_POLL_INTERVAL_MS * 180;

export type FalPollOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

function falKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not configured");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FalQueueStatus = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
};

export async function falSubscribe(
  modelId: string,
  input: Record<string, unknown>,
  options?: FalPollOptions,
): Promise<Record<string, unknown>> {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));

  const key = falKey();
  const headers = {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };

  const submitRes = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`fal submit failed (${submitRes.status}): ${body}`);
  }

  const submitJson = (await submitRes.json()) as { request_id?: string };
  const requestId = submitJson.request_id;
  if (!requestId) throw new Error("fal submit missing request_id");

  const statusUrl = `https://queue.fal.run/${modelId}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${modelId}/requests/${requestId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(pollIntervalMs);

    const statusRes = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    if (!statusRes.ok) {
      const body = await statusRes.text();
      throw new Error(`fal status failed (${statusRes.status}): ${body}`);
    }

    const status = (await statusRes.json()) as FalQueueStatus;
    if (status.status === "FAILED") {
      throw new Error(`fal job failed: ${status.error ?? "unknown error"}`);
    }
    if (status.status !== "COMPLETED") continue;

    const resultRes = await fetch(resultUrl, { headers: { Authorization: `Key ${key}` } });
    if (!resultRes.ok) {
      const body = await resultRes.text();
      throw new Error(`fal result failed (${resultRes.status}): ${body}`);
    }
    return (await resultRes.json()) as Record<string, unknown>;
  }

  throw new Error("fal job timed out");
}

export async function falQueueRun<T>(
  modelId: string,
  input: Record<string, unknown>,
  options?: FalPollOptions,
): Promise<T> {
  return (await falSubscribe(modelId, input, options)) as T;
}

export function falFileUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "url" in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : undefined;
  }
  return undefined;
}
