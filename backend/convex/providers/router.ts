import { runImageAdapter, supportsImageModel } from "./image";
import { runAudioAdapter } from "./audio";
import { runVideoAdapter } from "./video";
import { runUpscaleAdapter } from "./upscale";
import {
  AudioParams,
  GenerationParams,
  ImageParams,
  ProviderContext,
  ProviderResult,
  UpscaleParams,
} from "./types";

export async function routeToProvider(
  model: string,
  params: GenerationParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  switch (params.kind) {
    case "image":
      return imageAdapter(model, params, ctx);
    case "video":
      return videoAdapter(model, params, ctx);
    case "audio":
      return audioAdapter(model, params, ctx);
    case "upscale":
      return upscaleAdapter(model, params, ctx);
  }
}

async function imageAdapter(
  model: string,
  params: GenerationParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  if (params.kind !== "image") {
    throw new Error("Invalid params for image adapter");
  }
  if (!supportsImageModel(model)) {
    throw new Error(`unsupported image model: ${model}`);
  }
  return runImageAdapter(model, params as ImageParams, ctx);
}

async function videoAdapter(
  model: string,
  params: GenerationParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  if (params.kind !== "video") throw new Error("Expected video params");
  return runVideoAdapter(model, params, ctx);
}

async function audioAdapter(
  model: string,
  params: GenerationParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  if (params.kind !== "audio") {
    throw new Error("Invalid params for audio adapter");
  }
  return runAudioAdapter(model, params as AudioParams, ctx);
}

async function upscaleAdapter(
  model: string,
  params: GenerationParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  if (params.kind !== "upscale") {
    throw new Error("Invalid params for upscale adapter");
  }
  return runUpscaleAdapter(model, params as UpscaleParams, ctx);
}
