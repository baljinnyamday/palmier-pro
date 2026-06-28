import { falQueueRun } from "./fal";
import { ceilCredits } from "./shared";
import { ProviderContext, ProviderResult, UpscaleParams } from "./types";

type UpscaleSourceType = "image" | "video";

type UpscaleModelConfig = {
  falModelId: string;
  supportedTypes: readonly UpscaleSourceType[];
  creditsPerSecond: number;
  pollIntervalMs: number;
  timeoutMs: number;
};

const UPSCALE_MODELS: Record<string, UpscaleModelConfig> = {
  "seedvr-image-upscaler": {
    falModelId: "fal-ai/seedvr/upscale/image",
    supportedTypes: ["image"],
    creditsPerSecond: 2,
    pollIntervalMs: 2000,
    timeoutMs: 120_000,
  },
  "bytedance-upscaler": {
    falModelId: "fal-ai/bytedance-upscaler/upscale/video",
    supportedTypes: ["video"],
    creditsPerSecond: 4,
    pollIntervalMs: 5000,
    // Convex internal actions cap at ~10 min; keep poll budget under that with buffer.
    timeoutMs: 540_000,
  },
};

type SeedvrOutput = {
  image: { url: string; content_type?: string };
};

type BytedanceOutput = {
  video: { url: string; content_type?: string };
};

function upscaleCost(config: UpscaleModelConfig, durationSeconds: number): number {
  return ceilCredits(config.creditsPerSecond * Math.max(1, durationSeconds));
}

export async function runUpscaleAdapter(
  model: string,
  params: UpscaleParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const config = UPSCALE_MODELS[model];
  if (!config) {
    throw new Error(`Unknown upscale model: ${model}`);
  }

  const pollOptions = {
    pollIntervalMs: config.pollIntervalMs,
    timeoutMs: config.timeoutMs,
  };

  let providerUrl: string;

  if (model === "seedvr-image-upscaler") {
    const result = await falQueueRun<SeedvrOutput>(
      config.falModelId,
      { image_url: params.sourceURL },
      pollOptions,
    );
    providerUrl = result.image.url;
  } else if (model === "bytedance-upscaler") {
    const result = await falQueueRun<BytedanceOutput>(
      config.falModelId,
      { video_url: params.sourceURL },
      pollOptions,
    );
    providerUrl = result.video.url;
  } else {
    throw new Error(`Unknown upscale model: ${model}`);
  }

  const resultUrl = await ctx.rehostUrl(providerUrl);

  return {
    resultUrls: [resultUrl],
    costCredits: upscaleCost(config, params.durationSeconds),
  };
}
