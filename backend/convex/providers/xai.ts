import {
  PROVIDER_ACTION_TIMEOUT_MS,
  PROVIDER_POLL_INTERVAL_MS,
} from "./shared";

const XAI_BASE = "https://api.x.ai/v1";

export type XaiImageData = { b64_json?: string; url?: string };
export type XaiImageResponse = {
  data: XaiImageData[];
  usage?: { cost_in_usd_ticks?: number };
};

export type XaiVideoPollResult = { url: string; duration: number };

export type XaiPollOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

function xaiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY not configured");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function xaiFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(`${XAI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${xaiKey()}`,
      ...init.headers,
    },
  });
  return res;
}

export async function xaiImages(
  path: "generations" | "edits",
  body: Record<string, unknown>,
): Promise<XaiImageResponse> {
  const res = await xaiFetch(`/images/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`x.ai images/${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as XaiImageResponse;
}

export async function xaiVideoStart(
  path: "generations" | "edits" | "extensions",
  body: Record<string, unknown>,
): Promise<string> {
  const res = await xaiFetch(`/videos/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`x.ai videos/${path} failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { request_id?: string };
  if (!json.request_id) throw new Error("x.ai video start missing request_id");
  return json.request_id;
}

type XaiVideoStatusResponse = {
  status: string;
  video?: { url: string; duration: number };
  error?: { code?: string; message?: string };
};

export async function xaiVideoPoll(
  requestId: string,
  opts?: XaiPollOptions,
): Promise<XaiVideoPollResult> {
  const intervalMs = opts?.intervalMs ?? PROVIDER_POLL_INTERVAL_MS;
  const timeoutMs = opts?.timeoutMs ?? PROVIDER_ACTION_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);

    const res = await xaiFetch(`/videos/${requestId}`, { method: "GET" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`x.ai video poll failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as XaiVideoStatusResponse;
    if (json.status === "failed" || json.status === "expired") {
      const code = json.error?.code ?? json.status;
      const message = json.error?.message ?? "unknown error";
      throw new Error(`x.ai video failed: ${code}: ${message}`);
    }
    if (json.status !== "done") continue;

    const url = json.video?.url;
    if (!url) throw new Error("x.ai video done but missing URL");
    return { url, duration: json.video?.duration ?? 0 };
  }

  throw new Error("x.ai video timed out — retry");
}

export async function xaiTts(body: Record<string, unknown>): Promise<ArrayBuffer> {
  const res = await xaiFetch("/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`x.ai TTS failed (${res.status}): ${text}`);
  }
  return res.arrayBuffer();
}
