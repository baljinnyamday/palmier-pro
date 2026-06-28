export type ImageParams = {
  kind: "image";
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  imageURLs?: string[];
  numImages: number;
};

export type VideoParams = {
  kind: "video";
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution?: string;
  sourceVideoURL?: string;
  startFrameURL?: string;
  endFrameURL?: string;
  referenceImageURLs?: string[];
  referenceVideoURLs?: string[];
  referenceAudioURLs?: string[];
  generateAudio: boolean;
};

export type AudioParams = {
  kind: "audio";
  prompt: string;
  voice?: string;
  lyrics?: string;
  styleInstructions?: string;
  instrumental: boolean;
  durationSeconds?: number;
  videoURL?: string;
};

export type UpscaleParams = {
  kind: "upscale";
  sourceURL: string;
  durationSeconds: number;
};

export type GenerationParams =
  | ImageParams
  | VideoParams
  | AudioParams
  | UpscaleParams;

export type ProviderResult = { resultUrls: string[]; costCredits: number };

export type ProviderContext = {
  rehostUrl: (sourceUrl: string) => Promise<string>;
  storeBytes: (bytes: ArrayBuffer, contentType: string) => Promise<string>;
};
