import { falFileUrl, falSubscribe } from "./fal";
import { ceilCredits } from "./shared";
import { ProviderContext, ProviderResult, VideoParams } from "./types";

const MODEL_DISPLAY_NAME = "Seedance 2.0 Fast";

const ENDPOINTS = {
  textToVideo: "bytedance/seedance-2.0/fast/text-to-video",
  imageToVideo: "bytedance/seedance-2.0/fast/image-to-video",
  referenceToVideo: "bytedance/seedance-2.0/fast/reference-to-video",
} as const;

const CAPS = {
  durations: [5, 10],
  resolutions: ["480p", "720p"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  supportsFirstFrame: true,
  supportsLastFrame: true,
  maxReferenceImages: 4,
  maxReferenceVideos: 1,
  maxReferenceAudios: 1,
  maxTotalReferences: 5,
  framesAndReferencesExclusive: false,
};

const CREDITS_PER_SECOND: Record<string, number> = { "480p": 3, "720p": 4 };
const AUDIO_DISCOUNT_RATE: Record<string, number> = { "480p": 0.85, "720p": 0.85 };

const DEFAULT_RESOLUTION = "720p";
const DEFAULT_BILLING_DURATION = 5;

type SeedanceInput = Record<string, unknown>;

export async function runSeedanceVideo(
  params: VideoParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const refImages = params.referenceImageURLs ?? [];
  const refVideos = params.referenceVideoURLs ?? [];
  const refAudios = params.referenceAudioURLs ?? [];
  const hasSourceVideo = Boolean(params.sourceVideoURL);
  const hasRefs =
    refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0;
  const hasStartFrame = Boolean(params.startFrameURL);
  const hasEndFrame = Boolean(params.endFrameURL);

  const resolution = resolveResolution(params.resolution);
  const billingDuration = resolveBillingDuration(params);
  validateParams(params, {
    resolution,
    billingDuration,
    refImages,
    refVideos,
    refAudios,
    hasSourceVideo,
    hasRefs,
    hasStartFrame,
    hasEndFrame,
  });

  const { endpoint, input } = buildRequest(params, resolution, {
    refImages,
    refVideos,
    refAudios,
    hasSourceVideo,
    hasRefs,
    hasStartFrame,
    hasEndFrame,
  });

  const result = await falSubscribe(endpoint, input);
  const providerUrl = falFileUrl(result.video);
  if (!providerUrl) throw new Error("Provider returned no video URL");

  const resultUrl = await ctx.rehostUrl(providerUrl);

  return {
    resultUrls: [resultUrl],
    costCredits: computeCredits(resolution, billingDuration, params.generateAudio),
  };
}

function resolveResolution(resolution?: string): string {
  if (!resolution || resolution.length === 0) return DEFAULT_RESOLUTION;
  return resolution;
}

function resolveBillingDuration(params: VideoParams): number {
  if (params.duration > 0) return params.duration;
  if (params.sourceVideoURL) return DEFAULT_BILLING_DURATION;
  return 0;
}

function unsupportedValue(
  field: string,
  value: string,
  allowed: string[],
): string {
  return `${MODEL_DISPLAY_NAME} does not support ${field} '${value}'. Valid: ${allowed.join(", ")}.`;
}

function validateParams(
  params: VideoParams,
  ctx: {
    resolution: string;
    billingDuration: number;
    refImages: string[];
    refVideos: string[];
    refAudios: string[];
    hasSourceVideo: boolean;
    hasRefs: boolean;
    hasStartFrame: boolean;
    hasEndFrame: boolean;
  },
): void {
  const {
    resolution,
    billingDuration,
    refImages,
    refVideos,
    refAudios,
    hasSourceVideo,
    hasRefs,
    hasStartFrame,
    hasEndFrame,
  } = ctx;

  if (!hasSourceVideo) {
    if (CAPS.durations.length > 0 && params.duration > 0) {
      if (!CAPS.durations.includes(params.duration)) {
        throw new Error(
          unsupportedValue(
            "duration",
            `${params.duration}s`,
            CAPS.durations.map((d) => `${d}s`),
          ),
        );
      }
    } else if (params.duration <= 0) {
      throw new Error(`${MODEL_DISPLAY_NAME} requires a duration.`);
    }

    if (
      CAPS.aspectRatios.length > 0 &&
      params.aspectRatio.length > 0 &&
      !CAPS.aspectRatios.includes(params.aspectRatio)
    ) {
      throw new Error(
        unsupportedValue("aspect ratio", params.aspectRatio, [...CAPS.aspectRatios]),
      );
    }
  }

  if (
    CAPS.resolutions.length > 0 &&
    resolution.length > 0 &&
    !CAPS.resolutions.includes(resolution)
  ) {
    throw new Error(
      unsupportedValue("resolution", resolution, [...CAPS.resolutions]),
    );
  }

  if (hasStartFrame && !CAPS.supportsFirstFrame) {
    throw new Error(`${MODEL_DISPLAY_NAME} does not support a start frame.`);
  }
  if (hasEndFrame && !CAPS.supportsLastFrame) {
    throw new Error(`${MODEL_DISPLAY_NAME} does not support an end frame.`);
  }
  if (hasEndFrame && !hasStartFrame) {
    throw new Error(`${MODEL_DISPLAY_NAME} requires a start frame when an end frame is set.`);
  }

  if (CAPS.framesAndReferencesExclusive && hasRefs && (hasStartFrame || hasEndFrame)) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} does not support frames and references together.`,
    );
  }

  const videoRefs = hasSourceVideo
    ? [params.sourceVideoURL!, ...refVideos]
    : refVideos;
  if (refImages.length > CAPS.maxReferenceImages) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} supports at most ${CAPS.maxReferenceImages} reference images.`,
    );
  }
  if (videoRefs.length > CAPS.maxReferenceVideos) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} supports at most ${CAPS.maxReferenceVideos} reference videos.`,
    );
  }
  if (refAudios.length > CAPS.maxReferenceAudios) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} supports at most ${CAPS.maxReferenceAudios} reference audio files.`,
    );
  }

  const totalRefs = refImages.length + videoRefs.length + refAudios.length;
  if (CAPS.maxTotalReferences !== undefined && totalRefs > CAPS.maxTotalReferences) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} supports at most ${CAPS.maxTotalReferences} total references.`,
    );
  }

  if (refAudios.length > 0 && refImages.length === 0 && videoRefs.length === 0) {
    throw new Error(
      `${MODEL_DISPLAY_NAME} requires at least one reference image or video when audio references are provided.`,
    );
  }

  if (billingDuration <= 0 && !hasSourceVideo) {
    throw new Error(`${MODEL_DISPLAY_NAME} requires a duration.`);
  }
}

function buildRequest(
  params: VideoParams,
  resolution: string,
  ctx: {
    refImages: string[];
    refVideos: string[];
    refAudios: string[];
    hasSourceVideo: boolean;
    hasRefs: boolean;
    hasStartFrame: boolean;
    hasEndFrame: boolean;
  },
): { endpoint: string; input: SeedanceInput } {
  const common = {
    prompt: params.prompt,
    resolution,
    duration: params.duration > 0 ? String(params.duration) : "auto",
    aspect_ratio:
      params.aspectRatio.length > 0 ? params.aspectRatio : "auto",
    generate_audio: params.generateAudio,
  };

  const { refImages, refVideos, refAudios, hasSourceVideo, hasRefs, hasStartFrame, hasEndFrame } =
    ctx;

  if (hasSourceVideo || hasRefs) {
    const imageUrls = [...refImages];
    if (hasStartFrame) imageUrls.unshift(params.startFrameURL!);
    if (hasEndFrame) imageUrls.push(params.endFrameURL!);

    const videoUrls = hasSourceVideo
      ? [params.sourceVideoURL!, ...refVideos]
      : refVideos;

    const input: SeedanceInput = { ...common };
    if (imageUrls.length > 0) input.image_urls = imageUrls;
    if (videoUrls.length > 0) input.video_urls = videoUrls;
    if (refAudios.length > 0) input.audio_urls = refAudios;

    return { endpoint: ENDPOINTS.referenceToVideo, input };
  }

  if (hasStartFrame) {
    const input: SeedanceInput = {
      ...common,
      image_url: params.startFrameURL!,
    };
    if (hasEndFrame) input.end_image_url = params.endFrameURL!;
    return { endpoint: ENDPOINTS.imageToVideo, input };
  }

  return { endpoint: ENDPOINTS.textToVideo, input: common };
}

function computeCredits(
  resolution: string,
  durationSeconds: number,
  generateAudio: boolean,
): number {
  let rate = CREDITS_PER_SECOND[resolution] ?? CREDITS_PER_SECOND[DEFAULT_RESOLUTION];
  if (!generateAudio) {
    const discount = AUDIO_DISCOUNT_RATE[resolution] ?? AUDIO_DISCOUNT_RATE[DEFAULT_RESOLUTION];
    rate *= discount;
  }
  return ceilCredits(rate * durationSeconds);
}
