import { getCatalogEntry } from "../models";
import { runSeedanceVideo } from "./seedanceVideo";
import { ceilCredits } from "./shared";
import { xaiVideoPoll, xaiVideoStart } from "./xai";
import { ProviderContext, ProviderResult, VideoParams } from "./types";

const GROK_VIDEO_MODEL = "grok-imagine-video";
const GROK_VIDEO_15_MODEL = "grok-imagine-video-1.5";
const SEEDANCE_MODEL = "seedance-2.0-fast";

const GROK_DURATIONS = [5, 10, 15];
const GROK_15_DURATIONS = [5, 10, 15];
const GROK_RESOLUTIONS = ["480p", "720p"];
const GROK_15_RESOLUTIONS = ["480p", "720p", "1080p"];
const GROK_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
];

// TODO pricing
const GROK_CREDITS_PER_SECOND: Record<string, number> = { "480p": 5, "720p": 7 };
const GROK_15_CREDITS_PER_SECOND: Record<string, number> = {
  "480p": 5,
  "720p": 7,
  "1080p": 8,
};

const DEFAULT_RESOLUTION = "720p";

export async function runVideoAdapter(
  model: string,
  params: VideoParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  if (model === SEEDANCE_MODEL) {
    return runSeedanceVideo(params, ctx);
  }

  switch (model) {
    case GROK_VIDEO_MODEL:
      return runGrokImagineVideo(params, ctx);
    case GROK_VIDEO_15_MODEL:
      return runGrokImagineVideo15(params, ctx);
    default:
      throw new Error(`Unsupported video model: ${model}`);
  }
}

function assertGrokImagineVideoSupported(params: VideoParams): void {
  const name = "Grok Imagine Video";
  if (params.endFrameURL) {
    throw new Error(
      `${name} does not support an end frame. Select Seedance 2.0 Fast for first+last frame video.`,
    );
  }
  if ((params.referenceVideoURLs?.length ?? 0) > 0) {
    throw new Error(
      `${name} does not support reference video. Select Seedance 2.0 Fast for reference video conditioning.`,
    );
  }
  if ((params.referenceAudioURLs?.length ?? 0) > 0) {
    throw new Error(
      `${name} does not support reference audio. Select Seedance 2.0 Fast for reference audio conditioning.`,
    );
  }
}

async function runGrokImagineVideo(
  params: VideoParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  assertGrokImagineVideoSupported(params);

  const refImages = params.referenceImageURLs ?? [];
  const hasSourceVideo = Boolean(params.sourceVideoURL);
  const hasStartFrame = Boolean(params.startFrameURL);
  const hasRefs = refImages.length > 0;
  const resolution = resolveResolution(params.resolution, GROK_RESOLUTIONS);

  validateGrokVideo(params, {
    resolution,
    refImages,
    hasSourceVideo,
    hasStartFrame,
    hasRefs,
    durations: GROK_DURATIONS,
    resolutions: GROK_RESOLUTIONS,
    displayName: "Grok Imagine Video",
    requireStartFrame: false,
  });

  let requestId: string;
  if (hasSourceVideo) {
    requestId = await xaiVideoStart("edits", {
      model: GROK_VIDEO_MODEL,
      prompt: params.prompt,
      video: { url: params.sourceVideoURL! },
    });
  } else if (hasStartFrame) {
    const body: Record<string, unknown> = {
      model: GROK_VIDEO_MODEL,
      prompt: params.prompt,
      image: { url: params.startFrameURL! },
      duration: params.duration,
      resolution,
    };
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    requestId = await xaiVideoStart("generations", body);
  } else if (hasRefs) {
    requestId = await xaiVideoStart("generations", {
      model: GROK_VIDEO_MODEL,
      prompt: params.prompt,
      reference_images: refImages.map((url) => ({ url })),
      duration: params.duration,
      resolution,
      aspect_ratio: params.aspectRatio,
    });
  } else {
    requestId = await xaiVideoStart("generations", {
      model: GROK_VIDEO_MODEL,
      prompt: params.prompt,
      duration: params.duration,
      resolution,
      aspect_ratio: params.aspectRatio,
    });
  }

  const video = await xaiVideoPoll(requestId);
  const resultUrl = await ctx.rehostUrl(video.url);
  const effectiveDuration =
    video.duration > 0 ? video.duration : Math.max(1, params.duration);

  return {
    resultUrls: [resultUrl],
    costCredits: computeGrokCredits(
      GROK_CREDITS_PER_SECOND,
      resolution,
      effectiveDuration,
    ),
  };
}

async function runGrokImagineVideo15(
  params: VideoParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const refImages = params.referenceImageURLs ?? [];
  const hasSourceVideo = Boolean(params.sourceVideoURL);
  const hasStartFrame = Boolean(params.startFrameURL);
  const hasEndFrame = Boolean(params.endFrameURL);
  const hasRefVideos = (params.referenceVideoURLs?.length ?? 0) > 0;
  const hasRefAudios = (params.referenceAudioURLs?.length ?? 0) > 0;
  const resolution = resolveResolution(params.resolution, GROK_15_RESOLUTIONS);

  if (!hasStartFrame) {
    throw new Error("Grok Imagine Video 1.5 requires a start frame");
  }
  if (hasSourceVideo) {
    throw new Error("Grok Imagine Video 1.5 does not support source video");
  }
  if (hasEndFrame) {
    throw new Error("Grok Imagine Video 1.5 does not support an end frame");
  }
  if (refImages.length > 0 || hasRefVideos || hasRefAudios) {
    throw new Error("Grok Imagine Video 1.5 does not support reference assets");
  }

  validateGrokVideo(params, {
    resolution,
    refImages: [],
    hasSourceVideo: false,
    hasStartFrame: true,
    hasRefs: false,
    durations: GROK_15_DURATIONS,
    resolutions: GROK_15_RESOLUTIONS,
    displayName: "Grok Imagine Video 1.5",
    requireStartFrame: true,
  });

  const body: Record<string, unknown> = {
    model: GROK_VIDEO_15_MODEL,
    prompt: params.prompt,
    image: { url: params.startFrameURL! },
    duration: params.duration,
    resolution,
  };
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;

  const requestId = await xaiVideoStart("generations", body);
  const video = await xaiVideoPoll(requestId);
  const resultUrl = await ctx.rehostUrl(video.url);
  const effectiveDuration =
    video.duration > 0 ? video.duration : Math.max(1, params.duration);

  return {
    resultUrls: [resultUrl],
    costCredits: computeGrokCredits(
      GROK_15_CREDITS_PER_SECOND,
      resolution,
      effectiveDuration,
    ),
  };
}

function validateGrokVideo(
  params: VideoParams,
  ctx: {
    resolution: string;
    refImages: string[];
    hasSourceVideo: boolean;
    hasStartFrame: boolean;
    hasRefs: boolean;
    durations: number[];
    resolutions: string[];
    displayName: string;
    requireStartFrame: boolean;
  },
): void {
  const {
    resolution,
    refImages,
    hasSourceVideo,
    hasStartFrame,
    hasRefs,
    durations,
    resolutions,
    displayName,
    requireStartFrame,
  } = ctx;

  if (requireStartFrame && !hasStartFrame) {
    throw new Error(`${displayName} requires a start frame`);
  }

  if (!hasSourceVideo) {
    if (params.duration <= 0) {
      throw new Error(`${displayName} requires a duration`);
    }
    if (!durations.includes(params.duration)) {
      throw new Error(
        `${displayName} does not support duration ${params.duration}s. Valid: ${durations.map((d) => `${d}s`).join(", ")}.`,
      );
    }
    if (
      params.aspectRatio &&
      !GROK_ASPECT_RATIOS.includes(params.aspectRatio) &&
      !hasStartFrame
    ) {
      throw new Error(
        `${displayName} does not support aspect ratio '${params.aspectRatio}'.`,
      );
    }
  }

  if (!resolutions.includes(resolution)) {
    throw new Error(
      `${displayName} does not support resolution '${resolution}'. Valid: ${resolutions.join(", ")}.`,
    );
  }

  if (hasStartFrame && hasRefs) {
    throw new Error(`${displayName} does not support start frame with reference images`);
  }

  if (refImages.length > 3) {
    throw new Error(`${displayName} supports at most 3 reference images`);
  }
}

function resolveResolution(
  resolution: string | undefined,
  allowed: string[],
): string {
  if (resolution && allowed.includes(resolution)) return resolution;
  if (allowed.includes(DEFAULT_RESOLUTION)) return DEFAULT_RESOLUTION;
  return allowed[0] ?? DEFAULT_RESOLUTION;
}

function computeGrokCredits(
  table: Record<string, number>,
  resolution: string,
  durationSeconds: number,
): number {
  const rate = table[resolution] ?? table[DEFAULT_RESOLUTION];
  return ceilCredits(rate * Math.max(1, durationSeconds));
}

export function supportsVideoModel(model: string): boolean {
  const entry = getCatalogEntry(model);
  return entry?.kind === "video";
}
