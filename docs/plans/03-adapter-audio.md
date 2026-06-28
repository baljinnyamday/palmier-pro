# 03 — Audio adapter

Implements `audioAdapter(model, params)` in `backend/convex/providers/router.ts`. Depends on
`00-foundation.md`. Three sub-categories behind one entry point.

## Input (`AudioParams`, self-tagged `kind:"audio"`)

```
{ kind:"audio", prompt, voice?, lyrics?, styleInstructions?,
  instrumental, durationSeconds?, videoURL? }
```

Dispatch on the model's catalog `AudioCaps.category` (`"tts" | "music" | "sfx"`) plus
`inputs`:

| Category | Key inputs | `prompt` role |
|---|---|---|
| TTS | `prompt` (the words), `voice`, `styleInstructions?` | exact words to speak |
| Music | `prompt` (style/mood), `lyrics?`, `instrumental`, `durationSeconds?` | style/genre |
| Video-to-audio | `videoURL` (main input), `prompt?` (style guide) | optional guidance |

`videoURL` present ⇒ the request scores audio for that video (SFX/music from video). Only
non-null fields are sent.

## Required output

`{ resultUrls: string[], costCredits: number }` — one audio URL in `resultUrls[0]` (MP3
typical). Client imports as an audio asset. When `durationSeconds` is specified, the output
duration should match. (Video-to-audio results auto-place on the timeline client-side.)

## Implementation

1. Route `model` id → provider. Suggested first ids: **`elevenlabs-tts-v3`** (TTS),
   a music model (e.g. `lyria3-pro`), and a video-to-music model
   (e.g. `sonilo-v1.1-video-to-music`). Add keys to `.env.example`
   (`ELEVENLABS_API_KEY`, …).
2. Per-model validation from `AudioCaps`: `minPromptLength`, allowed `voices`, `minSeconds`/
   `maxSeconds`/`durations`. Reject violations with a clear error.
3. TTS: send `prompt` as the text, `voice`, optional `styleInstructions`. Music: send
   `prompt` as style, `lyrics`, `instrumental`, `durationSeconds`. Video-to-audio: send
   `videoURL` (+ optional `prompt` style).
4. Async if the provider is job-based — poll inside `process`. Re-host the result audio to
   Convex storage if the provider URL is short-lived.
5. `costCredits` from catalog `audioPricing`:
   - `perThousandChars` → `rate * ceil(promptChars / 1000)` (TTS)
   - `perSecond` → `rate * durationSeconds`
   - `flat` → `price`

## Decisions to make

- TTS pricing by characters vs flat (driven by `audioPricing.mode`).
- Music duration limits per provider; how to clamp/reject out-of-range `durationSeconds`.
- Video-to-audio: trust the client-rendered `videoURL` as-is.

## Catalog entries in `models.ts`

One per category you implement. `kind:"audio"`, `responseShape:"audio"`, `uiCapabilities` =
`AudioCaps` with the right `category`, `voices`/`defaultVoice` (TTS), `supportsLyrics`/
`supportsInstrumental` (music), `inputs:["video"]` (video-to-audio), `minPromptLength`,
`minSeconds`/`maxSeconds`. Set `audioPricing` accordingly.

## Acceptance

`generate_audio` produces audio that imports: test TTS (with a voice), music (with
duration), and video-to-audio (from a timeline span / `videoSourceMediaRef`).
