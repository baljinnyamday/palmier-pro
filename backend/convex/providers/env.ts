export type ProviderEnvVar =
  | "XAI_API_KEY"
  | "OPENAI_API_KEY"
  | "FAL_KEY"
  | "ELEVENLABS_API_KEY";

export const MODEL_REQUIRED_ENV: Record<string, ProviderEnvVar> = {
  "grok-imagine-image-quality": "XAI_API_KEY",
  "gpt-image-2": "OPENAI_API_KEY",
  "nano-banana-pro": "FAL_KEY",
  "grok-imagine-video": "XAI_API_KEY",
  "grok-imagine-video-1.5": "XAI_API_KEY",
  "seedance-2.0-fast": "FAL_KEY",
  "grok-tts": "XAI_API_KEY",
  "lyria3-pro": "FAL_KEY",
  "sonilo-v1.1-video-to-music": "FAL_KEY",
  "elevenlabs-tts-v3": "ELEVENLABS_API_KEY",
  "seedvr-image-upscaler": "FAL_KEY",
  "bytedance-upscaler": "FAL_KEY",
};

export function isEnvConfigured(key: ProviderEnvVar): boolean {
  const value = process.env[key];
  return typeof value === "string" && value.length > 0;
}

export function modelAvailability(id: string): {
  available: boolean;
  unavailableReason?: string;
} {
  const envVar = MODEL_REQUIRED_ENV[id];
  if (!envVar) return { available: true };
  if (isEnvConfigured(envVar)) return { available: true };
  return { available: false, unavailableReason: `Needs ${envVar}` };
}

export function assertModelAvailable(modelId: string, displayName?: string): void {
  const envVar = MODEL_REQUIRED_ENV[modelId];
  if (!envVar || isEnvConfigured(envVar)) return;
  const label = displayName ?? modelId;
  throw new Error(`${label} is unavailable: ${envVar} not configured`);
}
