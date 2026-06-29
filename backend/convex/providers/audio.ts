import { getCatalogEntry } from "../models";
import { falFileUrl, falSubscribe } from "./fal";
import { ceilCredits } from "./shared";
import { xaiTts } from "./xai";
import { AudioParams, ProviderContext, ProviderResult } from "./types";

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
  minSeconds?: number;
  maxSeconds?: number;
};

type AudioPricing = {
  mode: "perThousandChars" | "perSecond" | "flat";
  rate?: number;
  price?: number;
};

const ELEVENLABS_VOICES: Record<string, string> = {
  Rachel: "21m00Tcm4TlvDq8ikWAM",
  Drew: "29vD33N1CtxCmqQRPOHJ",
  Clyde: "2EiwWnXFnvU5JabPnv8n",
  Paul: "5Q0t7uMcjvnagdL7ziG5",
  Domi: "AZnzlk1XvdvUeBnXmlld",
  Dave: "CYw3kZ02Hs0563khs1Fj",
  Fin: "D38z5RcWu1voky8WS1ja",
  Sarah: "EXAVITQu4vr4xnSDxMaL",
  Antoni: "ErXwobaYiN019PkySvjV",
  Thomas: "GBv7mTt0atIp3Br8iCZE",
};

const AUDIO_MODELS = new Set([
  "grok-tts",
  "elevenlabs-tts-v3",
  "lyria3-pro",
  "sonilo-v1.1-video-to-music",
]);

const GROK_TTS_MAX_CHARS = 15_000;
const GROK_VOICES = new Set(["eve", "ara", "rex", "sal", "leo"]);

export function supportsAudioModel(model: string): boolean {
  return AUDIO_MODELS.has(model);
}

function audioCaps(entry: ReturnType<typeof getCatalogEntry>): AudioCaps {
  if (!entry || entry.kind !== "audio") {
    throw new Error("Unknown audio model");
  }
  return entry.uiCapabilities as AudioCaps;
}

function audioPricing(entry: ReturnType<typeof getCatalogEntry>): AudioPricing {
  if (!entry?.audioPricing) throw new Error("Model missing audio pricing");
  return entry.audioPricing;
}

function supportsVideoInput(caps: AudioCaps): boolean {
  return (caps.inputs ?? ["text"]).includes("video");
}

function validateAudioParams(
  model: string,
  params: AudioParams,
  caps: AudioCaps,
  displayName: string,
): void {
  if (!AUDIO_MODELS.has(model)) {
    throw new Error(`Audio adapter not implemented for model "${model}"`);
  }

  const promptLen = params.prompt.trim().length;
  const videoMode = Boolean(params.videoURL) && supportsVideoInput(caps);

  if (!videoMode && promptLen < caps.minPromptLength) {
    throw new Error(
      `${displayName} requires prompt ≥ ${caps.minPromptLength} characters (got ${promptLen})`,
    );
  }

  if (videoMode && !params.videoURL) {
    throw new Error(`${displayName} requires a video URL`);
  }

  if (!videoMode && caps.category === "tts") {
    const voice = params.voice?.trim() || caps.defaultVoice;
    if (!voice) throw new Error(`${displayName} requires a voice`);
    if (model === "grok-tts") {
      if (!GROK_VOICES.has(voice.toLowerCase())) {
        throw new Error(`${displayName} does not support voice "${voice}"`);
      }
    } else if (caps.voices && !caps.voices.includes(voice)) {
      throw new Error(`${displayName} does not support voice "${voice}"`);
    }
  }

  if (params.lyrics && !caps.supportsLyrics) {
    throw new Error(`${displayName} does not support lyrics`);
  }

  if (params.instrumental && !caps.supportsInstrumental) {
    throw new Error(`${displayName} does not support instrumental mode`);
  }

  if (params.styleInstructions && !caps.supportsStyleInstructions) {
    throw new Error(`${displayName} does not support style instructions`);
  }

  if (videoMode && params.durationSeconds === undefined) {
    throw new Error(
      `${displayName} requires durationSeconds for video-to-audio billing`,
    );
  }

  if (params.durationSeconds !== undefined) {
    if (caps.durations && !caps.durations.includes(params.durationSeconds)) {
      throw new Error(
        `${displayName} does not support duration ${params.durationSeconds}s`,
      );
    }
    const min = caps.minSeconds ?? 1;
    const max = caps.maxSeconds ?? 900;
    if (params.durationSeconds < min || params.durationSeconds > max) {
      throw new Error(
        `${displayName} accepts duration between ${min}s and ${max}s`,
      );
    }
  }
}

function computeCostCredits(
  params: AudioParams,
  pricing: AudioPricing,
  billableSeconds: number,
): number {
  switch (pricing.mode) {
    case "perThousandChars": {
      const chars = params.prompt.trim().length;
      const rate = pricing.rate ?? 0;
      return ceilCredits(rate * Math.ceil(chars / 1000));
    }
    case "perSecond": {
      const rate = pricing.rate ?? 0;
      return ceilCredits(rate * billableSeconds);
    }
    case "flat":
      return ceilCredits(pricing.price ?? 0);
  }
}

function buildLyriaPrompt(params: AudioParams, durationSeconds: number): string {
  const parts: string[] = [];
  const style = params.prompt.trim();
  if (style) parts.push(style);

  if (params.instrumental) {
    parts.push("Instrumental only, no vocals.");
  } else if (params.lyrics?.trim()) {
    parts.push(`Lyrics: ${params.lyrics.trim()}`);
  }

  const hasContent = Boolean(style || params.instrumental || params.lyrics?.trim());
  if (!hasContent) {
    throw new Error("Music generation requires a style prompt or lyrics");
  }

  parts.push(`Target length: approximately ${durationSeconds} seconds.`);
  return parts.join(" ");
}

function billableSeconds(params: AudioParams, caps: AudioCaps): number {
  if (params.durationSeconds !== undefined) return params.durationSeconds;
  if (Boolean(params.videoURL) && supportsVideoInput(caps)) {
    // Client should always pass source duration; validation rejects video mode without it.
    return caps.minSeconds ?? 1;
  }
  if (caps.durations?.length) return caps.durations[0];
  if (caps.category === "music") return 60;
  return 1;
}

async function grokTts(
  params: AudioParams,
  caps: AudioCaps,
  ctx: ProviderContext,
): Promise<string> {
  let text = params.prompt.trim();
  if (text.length > GROK_TTS_MAX_CHARS) {
    throw new Error(
      `Grok TTS accepts at most ${GROK_TTS_MAX_CHARS} characters (got ${text.length})`,
    );
  }
  if (params.styleInstructions?.trim()) {
    text = `${params.styleInstructions.trim()} ${text}`;
  }

  const voiceName = (params.voice?.trim() || caps.defaultVoice || "eve").toLowerCase();
  const bytes = await xaiTts({
    text,
    voice_id: voiceName,
    language: "auto",
    output_format: {
      codec: "mp3",
      sample_rate: 24000,
      bit_rate: 128000,
    },
  });

  return ctx.storeBytes(bytes, "audio/mpeg");
}

async function elevenLabsTts(
  params: AudioParams,
  caps: AudioCaps,
  ctx: ProviderContext,
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const voiceName = params.voice?.trim() || caps.defaultVoice;
  if (!voiceName) throw new Error("Voice is required");
  const voiceId = ELEVENLABS_VOICES[voiceName];
  if (!voiceId) throw new Error(`Unknown voice "${voiceName}"`);

  let text = params.prompt.trim();
  if (params.styleInstructions?.trim()) {
    text = `${params.styleInstructions.trim()} ${text}`;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_v3",
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${body}`);
  }

  return ctx.storeBytes(await res.arrayBuffer(), "audio/mpeg");
}

async function falLyriaMusic(
  params: AudioParams,
  caps: AudioCaps,
  ctx: ProviderContext,
): Promise<string> {
  const durationSeconds = billableSeconds(params, caps);
  const result = await falSubscribe("fal-ai/lyria3/pro", {
    prompt: buildLyriaPrompt(params, durationSeconds),
  });

  const audioUrl = falFileUrl(result.audio);
  if (!audioUrl) throw new Error("Lyria returned no audio URL");
  return ctx.rehostUrl(audioUrl);
}

async function falSoniloVideoToMusic(
  params: AudioParams,
  ctx: ProviderContext,
): Promise<string> {
  if (!params.videoURL) throw new Error("videoURL is required");

  const input: Record<string, unknown> = {
    video_url: params.videoURL,
  };
  const style = params.prompt.trim();
  if (style) input.prompt = style;
  if (params.durationSeconds !== undefined) {
    input.duration = params.durationSeconds;
  }

  const result = await falSubscribe("sonilo/v1.1/video-to-music", input);

  if (Array.isArray(result.audios) && result.audios.length > 0) {
    const first = falFileUrl(result.audios[0]);
    if (first) return ctx.rehostUrl(first);
  }

  const single = falFileUrl(result.audio);
  if (single) return ctx.rehostUrl(single);

  throw new Error("Sonilo returned no audio URL");
}

export async function runAudioAdapter(
  model: string,
  params: AudioParams,
  ctx: ProviderContext,
): Promise<ProviderResult> {
  const entry = getCatalogEntry(model);
  if (!entry || entry.kind !== "audio") {
    throw new Error(`Unknown audio model "${model}"`);
  }

  const caps = audioCaps(entry);
  const pricing = audioPricing(entry);
  validateAudioParams(model, params, caps, entry.displayName);

  const videoMode = Boolean(params.videoURL) && supportsVideoInput(caps);
  const seconds = billableSeconds(params, caps);

  let resultUrl: string;
  if (videoMode) {
    if (model !== "sonilo-v1.1-video-to-music") {
      throw new Error(`${entry.displayName} does not support video-to-audio`);
    }
    resultUrl = await falSoniloVideoToMusic(params, ctx);
  } else {
    switch (model) {
      case "grok-tts":
        resultUrl = await grokTts(params, caps, ctx);
        break;
      case "elevenlabs-tts-v3":
        resultUrl = await elevenLabsTts(params, caps, ctx);
        break;
      case "lyria3-pro":
        resultUrl = await falLyriaMusic(params, caps, ctx);
        break;
      default:
        throw new Error(`Audio adapter not implemented for model "${model}"`);
    }
  }

  return {
    resultUrls: [resultUrl],
    costCredits: computeCostCredits(params, pricing, seconds),
  };
}
