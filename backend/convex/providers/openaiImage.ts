const OPENAI_BASE = "https://api.openai.com/v1";

export type OpenAiImageData = { b64_json?: string; url?: string };
export type OpenAiImageResponse = { data: OpenAiImageData[] };

function openaiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  return key;
}

export async function openaiImageGenerate(
  body: Record<string, unknown>,
): Promise<OpenAiImageResponse> {
  const res = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI images/generations failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OpenAiImageResponse;
}

export async function openaiImageEdit(
  form: FormData,
): Promise<OpenAiImageResponse> {
  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI images/edits failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OpenAiImageResponse;
}

export async function downloadUrlBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status})`);
  }
  return res.arrayBuffer();
}
