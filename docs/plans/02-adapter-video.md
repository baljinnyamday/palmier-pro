# 02 — Video adapter

Implements `videoAdapter(model, params)` in `backend/convex/providers/router.ts`. Depends on
`00-foundation.md`. The most expensive and slowest kind — always job-based (poll).

## Input (`VideoParams`, self-tagged `kind:"video"`)

```
{ kind:"video", prompt, duration, aspectRatio, resolution?,
  sourceVideoURL?, startFrameURL?, endFrameURL?,
  referenceImageURLs?, referenceVideoURLs?, referenceAudioURLs?, generateAudio }
```

Two modes, distinguished by presence of `sourceVideoURL`:
- **Text-to-video**: `prompt` + optional `startFrameURL` / `endFrameURL` + optional
  reference image/video/audio URLs.
- **Video-to-video edit** (e.g. Motion Control): `sourceVideoURL` present, `duration` may be
  `0` and `aspectRatio` `""` (inherit from source). Optional image refs.

`generateAudio: true` means the model should embed/sync audio in the output MP4. Absent URL
arrays mean none were provided — treat as `[]`.

## Required output

`{ resultUrls: string[], costCredits: number }` — one MP4 URL in `resultUrls[0]`. Client
saves `.mp4`, imports as a video asset.

## Implementation

1. Route `model` id to the provider (Seedance / Veo / Kling / Grok …). Suggested first id:
   **`seedance-2.0-fast`**. Add the provider key to `.env.example`.
2. Validate `duration` / `aspectRatio` / `resolution` against the model's `VideoCaps`
   (durations, resolutions, aspectRatios). Reject unsupported combos with a clear error
   (surfaces to the user as the tool failure).
3. Pass frames (`startFrameURL`/`endFrameURL`) and reference arrays per the provider's API.
   Respect `maxReferenceImages/Videos/Audios` and `framesAndReferencesExclusive` from caps.
4. **Async:** submit the job, then poll the provider until done. Keep the whole wait inside
   the `process` action (it can run long). Patch nothing else; the Convex job stays
   `running` until you return.
5. **Result durability:** provider MP4 URLs often expire — re-host to Convex storage
   (`ctx.storage.store` → `getUrl`) and return that URL.
6. `costCredits` = catalog `creditsPerSecond[resolution] * duration` (apply
   `audioDiscountRate` if `generateAudio` is false and the model discounts silent output).

## Decisions to make

- Poll interval / timeout and how to surface provider failure messages.
- Whether to re-host the MP4 (recommended) or pass the provider URL straight through.
- For edit mode with `duration:0`, derive effective duration from the source for billing.

## Catalog entry in `models.ts`

`kind:"video"`, `responseShape:"video"`, `uiCapabilities` = full `VideoCaps`,
`creditsPerSecond: { "720p": <n>, ... }`, optional `audioDiscountRate`. Match the `id` your
adapter dispatches on. For an edit model set `requiresSourceVideo:true`.

## Acceptance

`generate_video` (text-to-video) yields an MP4 that imports. Then test edit mode with a
`sourceVideoMediaRef`, and frame conditioning with start/end frames.
