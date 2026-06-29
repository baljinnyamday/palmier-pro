import { query } from "./_generated/server";
import { modelAvailability } from "./providers/env";

type VideoCaps = {
  durations: number[];
  resolutions?: string[];
  aspectRatios: string[];
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  maxTotalReferences?: number;
  maxCombinedVideoRefSeconds?: number;
  maxCombinedAudioRefSeconds?: number;
  framesAndReferencesExclusive: boolean;
  referenceTagNoun: string;
  requiresSourceVideo: boolean;
  requiresReferenceImage: boolean;
};

type ImageCaps = {
  resolutions?: string[];
  aspectRatios: string[];
  qualities?: string[];
  supportsImageReference: boolean;
  maxImages: number;
};

type AudioCaps = {
  category: "tts" | "music" | "sfx";
  voices?: string[];
  defaultVoice?: string;
  supportsLyrics: boolean;
  supportsInstrumental: boolean;
  supportsStyleInstructions: boolean;
  durations?: number[];
  minPromptLength: number;
  inputs?: string[];
  promptLabel?: string;
  minSeconds?: number;
  maxSeconds?: number;
};

type UpscaleCaps = {
  speed: "Fast" | "Medium" | "Slow";
  p75DurationSeconds: number;
  supportedTypes: string[];
};

type CatalogEntry = {
  id: string;
  kind: "video" | "image" | "audio" | "upscale";
  displayName: string;
  allowedEndpoints: string[];
  responseShape: "video" | "images" | "audio" | "upscaledImage";
  uiCapabilities: VideoCaps | ImageCaps | AudioCaps | UpscaleCaps;
  creditsPerSecond?: Record<string, number>;
  audioDiscountRate?: Record<string, number>;
  creditsPerImage?: Record<string, number>;
  qualities?: string[];
  audioPricing?: {
    mode: "perThousandChars" | "perSecond" | "flat";
    rate?: number;
    price?: number;
  };
  creditsPerSecondUpscale?: number;
};

export type ListCatalogEntry = CatalogEntry & {
  available: boolean;
  unavailableReason?: string;
};

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

const CATALOG: CatalogEntry[] = [
  {
    id: "grok-imagine-image-quality",
    kind: "image",
    displayName: "Grok Imagine Image",
    allowedEndpoints: ["generate_image"],
    responseShape: "images",
    // TODO pricing
    creditsPerImage: { "1K": 5, "2K": 5 },
    uiCapabilities: {
      resolutions: ["1K", "2K"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      qualities: ["standard"],
      supportsImageReference: true,
      maxImages: 4,
    } satisfies ImageCaps,
  },
  {
    id: "gpt-image-2",
    kind: "image",
    displayName: "GPT Image 2",
    allowedEndpoints: ["generate_image"],
    responseShape: "images",
    // TODO pricing: replace after OpenAI calculator pass
    creditsPerImage: {
      "1024x1024": 8,
      "1536x1024": 10,
      "1024x1536": 10,
      "2560x1440": 15,
    },
    uiCapabilities: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      qualities: ["low", "medium", "high"],
      supportsImageReference: true,
      maxImages: 4,
    } satisfies ImageCaps,
  },
  {
    id: "nano-banana-pro",
    kind: "image",
    displayName: "Nano Banana Pro",
    allowedEndpoints: ["generate_image"],
    responseShape: "images",
    creditsPerImage: { "2K": 8, "4K": 16 },
    uiCapabilities: {
      resolutions: ["2K", "4K"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      qualities: ["standard", "hd"],
      supportsImageReference: true,
      maxImages: 4,
    } satisfies ImageCaps,
  },
  {
    id: "grok-imagine-video",
    kind: "video",
    displayName: "Grok Imagine Video",
    allowedEndpoints: ["generate_video"],
    responseShape: "video",
    // TODO pricing
    creditsPerSecond: { "480p": 5, "720p": 7 },
    uiCapabilities: {
      durations: [5, 10, 15],
      resolutions: ["480p", "720p"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      supportsFirstFrame: true,
      supportsLastFrame: false,
      maxReferenceImages: 3,
      maxReferenceVideos: 0,
      maxReferenceAudios: 0,
      framesAndReferencesExclusive: true,
      referenceTagNoun: "reference",
      requiresSourceVideo: false,
      requiresReferenceImage: false,
    } satisfies VideoCaps,
  },
  {
    id: "grok-imagine-video-1.5",
    kind: "video",
    displayName: "Grok Imagine Video 1.5",
    allowedEndpoints: ["generate_video"],
    responseShape: "video",
    // TODO pricing
    creditsPerSecond: { "480p": 5, "720p": 7, "1080p": 8 },
    uiCapabilities: {
      durations: [5, 10, 15],
      resolutions: ["480p", "720p", "1080p"],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      supportsFirstFrame: true,
      supportsLastFrame: false,
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxReferenceAudios: 0,
      framesAndReferencesExclusive: false,
      referenceTagNoun: "reference",
      requiresSourceVideo: false,
      requiresReferenceImage: false,
    } satisfies VideoCaps,
  },
  {
    id: "seedance-2.0-fast",
    kind: "video",
    displayName: "Seedance 2.0 Fast",
    allowedEndpoints: ["generate_video"],
    responseShape: "video",
    creditsPerSecond: { "480p": 3, "720p": 4 },
    audioDiscountRate: { "480p": 0.85, "720p": 0.85 },
    uiCapabilities: {
      durations: [5, 10],
      resolutions: ["480p", "720p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      supportsFirstFrame: true,
      supportsLastFrame: true,
      maxReferenceImages: 4,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
      maxTotalReferences: 5,
      maxCombinedVideoRefSeconds: 30,
      maxCombinedAudioRefSeconds: 60,
      framesAndReferencesExclusive: false,
      referenceTagNoun: "reference",
      requiresSourceVideo: false,
      requiresReferenceImage: false,
    } satisfies VideoCaps,
  },
  {
    id: "grok-tts",
    kind: "audio",
    displayName: "Grok TTS",
    allowedEndpoints: ["generate_audio"],
    responseShape: "audio",
    // TODO pricing
    audioPricing: { mode: "perThousandChars", rate: 1 },
    uiCapabilities: {
      category: "tts",
      voices: ["eve", "ara", "rex", "sal", "leo"],
      defaultVoice: "eve",
      supportsLyrics: false,
      supportsInstrumental: false,
      supportsStyleInstructions: true,
      minPromptLength: 1,
      inputs: ["text"],
      promptLabel: "Text to speak",
    } satisfies AudioCaps,
  },
  {
    id: "lyria3-pro",
    kind: "audio",
    displayName: "Lyria 3 Pro",
    allowedEndpoints: ["generate_audio"],
    responseShape: "audio",
    audioPricing: { mode: "perSecond", rate: 2.5 },
    uiCapabilities: {
      category: "music",
      supportsLyrics: true,
      supportsInstrumental: true,
      supportsStyleInstructions: false,
      durations: [30, 60, 120, 180],
      minPromptLength: 3,
      inputs: ["text"],
      promptLabel: "Style and mood",
      minSeconds: 30,
      maxSeconds: 180,
    } satisfies AudioCaps,
  },
  {
    id: "sonilo-v1.1-video-to-music",
    kind: "audio",
    displayName: "Sonilo Video to Music",
    allowedEndpoints: ["generate_audio"],
    responseShape: "audio",
    audioPricing: { mode: "perSecond", rate: 3 },
    uiCapabilities: {
      category: "music",
      supportsLyrics: false,
      supportsInstrumental: false,
      supportsStyleInstructions: false,
      minPromptLength: 0,
      inputs: ["video"],
      promptLabel: "Style guide (optional)",
      minSeconds: 1,
      maxSeconds: 600,
    } satisfies AudioCaps,
  },
  {
    id: "elevenlabs-tts-v3",
    kind: "audio",
    displayName: "ElevenLabs TTS v3",
    allowedEndpoints: ["generate_audio"],
    responseShape: "audio",
    audioPricing: { mode: "perThousandChars", rate: 1.5 },
    uiCapabilities: {
      category: "tts",
      voices: [
        "Rachel",
        "Drew",
        "Clyde",
        "Paul",
        "Domi",
        "Dave",
        "Fin",
        "Sarah",
        "Antoni",
        "Thomas",
      ],
      defaultVoice: "Rachel",
      supportsLyrics: false,
      supportsInstrumental: false,
      supportsStyleInstructions: true,
      minPromptLength: 1,
      inputs: ["text"],
      promptLabel: "Text to speak",
    } satisfies AudioCaps,
  },
  {
    id: "seedvr-image-upscaler",
    kind: "upscale",
    displayName: "SeedVR Upscaler",
    allowedEndpoints: ["upscale_media"],
    responseShape: "upscaledImage",
    creditsPerSecondUpscale: 2,
    uiCapabilities: {
      speed: "Fast",
      p75DurationSeconds: 30,
      supportedTypes: ["image"],
    } satisfies UpscaleCaps,
  },
  {
    id: "bytedance-upscaler",
    kind: "upscale",
    displayName: "ByteDance Upscaler",
    allowedEndpoints: ["upscale_media"],
    responseShape: "upscaledImage",
    creditsPerSecondUpscale: 4,
    uiCapabilities: {
      speed: "Slow",
      p75DurationSeconds: 180,
      supportedTypes: ["video"],
    } satisfies UpscaleCaps,
  },
];

export const list = query({
  args: {},
  handler: async (): Promise<ListCatalogEntry[]> =>
    CATALOG.map((entry) => {
      const { available, unavailableReason } = modelAvailability(entry.id);
      return {
        ...entry,
        available,
        ...(unavailableReason ? { unavailableReason } : {}),
      };
    }),
});
