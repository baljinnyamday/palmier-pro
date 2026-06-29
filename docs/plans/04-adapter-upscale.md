# 04 — Upscale adapter

Implements `upscaleAdapter(model, params)` in `backend/convex/providers/router.ts`. Depends
on `00-foundation.md`. Enhancement of existing media, not generation from scratch.

## Input (`UpscaleParams`, self-tagged `kind:"upscale"`)

```
{ kind:"upscale", sourceURL, durationSeconds }
```
- `sourceURL` — the uploaded source media (video or image), always present.
- `durationSeconds` — video length for credit calc; `1` for images.

The source type (video vs image) is implied by the chosen `model` and its
`UpscaleCaps.supportedTypes` (`"video"` / `"image"`).

## Required output

`{ resultUrls: string[], costCredits: number }` — one URL in `resultUrls[0]`, **same type as
the input** (MP4 for video, image for image), at higher resolution. The client creates a new
placeholder asset named "Upscaled …".

## Implementation

1. Route `model` id → upscaler by source type. Suggested first ids:
   **`seedvr-image-upscaler`** (image), **`bytedance-upscaler`** (video). Add keys to
   `.env.example`.
2. Submit the source, poll if the provider is async (video upscales are slow). Keep the wait
   inside `process`.
3. Re-host the upscaled result to Convex storage if the provider URL expires; return that
   URL.
4. `costCredits`:
   - video → catalog `creditsPerSecondUpscale * durationSeconds`
   - image → a flat charge (`durationSeconds` is `1`).

## Decisions to make

- Poll interval / timeout for slow video upscales.
- Whether to validate that `model.supportedTypes` matches the source type and reject
  mismatches early.

## Catalog entries in `models.ts`

`kind:"upscale"`, `responseShape:"upscaledImage"` (the enum value used for both video and
image upscalers), `uiCapabilities` = `UpscaleCaps`
(`{ speed:"Fast"|"Medium"|"Slow", p75DurationSeconds, supportedTypes }`),
`creditsPerSecondUpscale: <n>`. Provide separate entries for the image upscaler
(`supportedTypes:["image"]`) and the video upscaler (`supportedTypes:["video"]`).

## Acceptance

`upscale_media` on an image asset yields a higher-res image as a new "Upscaled …" asset.
Then test on a trimmed video clip (`sourceClipId`).
