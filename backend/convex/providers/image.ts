import { isEnvConfigured } from "./env";
import { falSubscribe } from "./fal";
import {
  downloadUrlBytes,
  openaiImageEdit,
  openaiImageGenerate,
} from "./openaiImage";
import { ceilCredits } from "./shared";
import { xaiImages } from "./xai";
import { ImageParams, ProviderContext, ProviderResult } from "./types";

const IMAGE_MODELS = new Set([
  "grok-imagine-image-quality",
  "gpt-image-2",
  "nano-banana-pro",
]);

const FAL_T2I = "fal-ai/nano-banana-pro";
const FAL_EDIT = "fal-ai/nano-banana-pro/edit";

// TODO pricing: replace after OpenAI calculator pass
const GROK_CREDITS_PER_IMAGE: Record<string, number> = { "1K": 5, "2K": 5 };
const GPT_CREDITS_PER_SIZE: Record<string, number> = {
  "1024x1024": 8,
  "1536x1024": 10,
  "1024x1536": 10,
  "1536x864": 10,
  "864x1536": 10,
  "1536x1152": 10,
  "1152x1536": 10,
  "2560x1440": 15,
};
const FAL_CREDITS_PER_IMAGE: Record<string, number> = { "2K": 8, "4K": 16 };

type FalImageFile = { url: string; content_type?: string };
type FalImageResponse = { images: FalImageFile[] };

export function supportsImageModel(model: string): boolean {
  return IMAGE_MODELS.has(model);
}

export async function runImageAdapter(
  model: string,
  params: ImageParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  switch (model) {
    case "grok-imagine-image-quality":
      return withImageFallback(
        () => runGrokImagineImage(params, ctx),
        () => runGptImage2(params, ctx),
      );
    case "gpt-image-2":
      return runGptImage2(params, ctx);
    case "nano-banana-pro":
      return runNanoBananaPro(params, ctx);
    default:
      throw new Error(`unsupported image model: ${model}`);
  }
}

async function withImageFallback(
  primary: () => Promise<ProviderResult>,
  secondary: () => Promise<ProviderResult>,
): Promise<ProviderResult> {
  try {
    return await primary();
  } catch (err) {
    if (!isRetryableImageError(err)) throw err;
    return secondary();
  }
}

function isRetryableImageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg.includes("XAI_API_KEY not configured")) {
    return isEnvConfigured("OPENAI_API_KEY");
  }
  return (
    msg.includes("(429)") ||
    msg.includes("(500)") ||
    msg.includes("(502)") ||
    msg.includes("(503)") ||
    msg.includes("(504)") ||
    msg.includes("timed out")
  );
}

async function runGrokImagineImage(
  params: ImageParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const refs = params.imageURLs ?? [];
  const hasRefs = refs.length > 0;
  const resolution = mapGrokResolution(params.resolution, params.quality);
  const n = Math.min(Math.max(1, params.numImages), 10);

  const body: Record<string, unknown> = {
    model: "grok-imagine-image-quality",
    prompt: params.prompt,
    n,
    response_format: "b64_json",
  };

  if (hasRefs) {
    if (refs.length === 1) {
      body.image = { url: refs[0] };
    } else {
      body.images = refs.map((url) => ({ url }));
    }
    if (refs.length > 1 || params.aspectRatio) {
      body.aspect_ratio = params.aspectRatio || "auto";
    }
    body.resolution = resolution;
  } else {
    body.aspect_ratio = params.aspectRatio;
    body.resolution = resolution;
  }

  const result = await xaiImages(hasRefs ? "edits" : "generations", body);
  const resultUrls = await storeB64Images(result.data ?? [], ctx);
  if (resultUrls.length === 0) throw new Error("Provider returned no images");

  return {
    resultUrls,
    costCredits: computeGrokCredits(resolution, resultUrls.length),
  };
}

async function runGptImage2(
  params: ImageParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const refs = params.imageURLs ?? [];
  const hasRefs = refs.length > 0;
  const size = mapOpenAiSize(params.aspectRatio);
  const quality = mapOpenAiQuality(params.quality);
  const n = Math.min(Math.max(1, params.numImages), 4);

  let result;
  if (hasRefs) {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", params.prompt);
    form.append("n", String(n));
    form.append("size", size);
    form.append("quality", quality);
    for (const url of refs) {
      const bytes = await downloadUrlBytes(url);
      form.append("image[]", new Blob([bytes], { type: "image/png" }), "image.png");
    }
    result = await openaiImageEdit(form);
  } else {
    result = await openaiImageGenerate({
      model: "gpt-image-2",
      prompt: params.prompt,
      n,
      size,
      quality,
    });
  }

  const resultUrls = await storeB64Images(result.data ?? [], ctx);
  if (resultUrls.length === 0) throw new Error("Provider returned no images");

  return {
    resultUrls,
    costCredits: computeGptCredits(size, resultUrls.length),
  };
}

export async function runNanoBananaPro(
  params: ImageParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const falResolution = mapFalResolution(params.resolution, params.quality);
  const hasRefs = (params.imageURLs?.length ?? 0) > 0;
  const endpoint = hasRefs ? FAL_EDIT : FAL_T2I;

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio,
    resolution: falResolution,
    num_images: params.numImages,
    output_format: "jpeg",
  };
  if (hasRefs) {
    input.image_urls = params.imageURLs;
  }

  const result = (await falSubscribe(endpoint, input)) as FalImageResponse;
  const images = result.images ?? [];
  if (images.length === 0) throw new Error("Provider returned no images");

  const resultUrls = await Promise.all(images.map((img) => ctx.rehostUrl(img.url)));

  return {
    resultUrls,
    costCredits: computeFalCredits(falResolution, resultUrls.length),
  };
}

async function storeB64Images(
  data: Array<{ b64_json?: string; url?: string }>,
  ctx: ProviderContext,
): Promise<string[]> {
  const urls: string[] = [];
  for (const item of data) {
    if (item.b64_json) {
      const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
      urls.push(await ctx.storeBytes(bytes.buffer, "image/png"));
    } else if (item.url) {
      urls.push(await ctx.rehostUrl(item.url));
    }
  }
  return urls;
}

function mapGrokResolution(
  resolution: string | undefined,
  quality: string | undefined,
): string {
  if (resolution === "2K" || resolution === "4K") return "2k";
  if (resolution === "1K") return "1k";
  if (quality === "hd") return "2k";
  return "1k";
}

function mapFalResolution(
  resolution: string | undefined,
  quality: string | undefined,
): string {
  if (resolution === "2K" || resolution === "4K" || resolution === "1K") {
    return resolution;
  }
  if (quality === "hd") return "4K";
  if (quality === "standard") return "2K";
  return "2K";
}

function mapOpenAiSize(aspectRatio: string): string {
  const table: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1536x864",
    "9:16": "864x1536",
    "4:3": "1536x1152",
    "3:4": "1152x1536",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
  };
  return table[aspectRatio] ?? "1024x1024";
}

function mapOpenAiQuality(quality: string | undefined): string {
  if (quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }
  if (quality === "hd") return "high";
  return "medium";
}

function computeGrokCredits(resolution: string, numImages: number): number {
  const key = resolution === "2k" ? "2K" : "1K";
  const rate = GROK_CREDITS_PER_IMAGE[key] ?? GROK_CREDITS_PER_IMAGE["1K"];
  return ceilCredits(rate * Math.max(1, numImages));
}

function computeGptCredits(size: string, numImages: number): number {
  const rate = GPT_CREDITS_PER_SIZE[size] ?? GPT_CREDITS_PER_SIZE["1024x1024"];
  return ceilCredits(rate * Math.max(1, numImages));
}

function computeFalCredits(resolution: string, numImages: number): number {
  const rate = FAL_CREDITS_PER_IMAGE[resolution] ?? FAL_CREDITS_PER_IMAGE["2K"];
  return ceilCredits(rate * Math.max(1, numImages));
}
