# 01 — Image adapter

Implements `imageAdapter(model, params)` inside `backend/convex/providers/router.ts`.
**Do this adapter first** — images are the cheapest and fastest path to validate the whole
swap end to end. Depends on `00-foundation.md`.

## Input (`ImageParams`, self-tagged `kind:"image"`)

```
{ kind:"image", prompt, aspectRatio, resolution?, quality?, imageURLs?, numImages }
```
- `imageURLs` present → reference-image conditioning (image-to-image). Absent → text-to-image.
- `numImages` from the agent path is always `1`; UI may request up to 4.
- `resolution` examples: `"2K"`, `"4K"`, or explicit `"1920x1080"`. `quality` is
  model-dependent.

## Required output

`{ resultUrls: string[], costCredits: number }` — one or more image URLs (PNG/JPG/WebP). The
Swift client downloads `resultUrls[0]`, saves it as `.jpg`, and imports it as an image asset.

## Implementation

1. Pick a provider per `model` id. Suggested first model id: **`nano-banana-pro`** (or any
   image model you have a key for). Add its key to `.env.example` (e.g. `FAL_KEY`).
2. Map `aspectRatio` / `resolution` / `quality` to the provider's params; pass `imageURLs`
   for conditioning when present; honor `numImages`.
3. Submit, await the result (image models are usually near-synchronous; poll if the provider
   is async — see decision below).
4. **Result URL durability:** if the provider returns a short-lived URL, re-host it: download
   the bytes and `ctx.storage.store(...)` then `ctx.storage.getUrl(...)`, return that. The
   Swift client may not download immediately. (The adapter runs inside the `process` action,
   which has `ctx.storage`.)
5. Compute `costCredits` from the catalog `creditsPerImage[resolution] * numImages` (or a
   flat number for now).

## Decisions to make

- **Sync vs poll:** start synchronous (`await provider.generate(...)`). Only add polling if
  the provider is job-based.
- **Provider choice / model id:** must match the `id` you seed in `models.ts` (`00`) so the
  app can select it.

## Catalog entry to add in `models.ts`

`kind:"image"`, `responseShape:"images"`, `uiCapabilities` = `ImageCaps`
(`{ resolutions, aspectRatios, qualities?, supportsImageReference, maxImages }`),
`creditsPerImage: { "2K": <n>, ... }`. Match the `id` your adapter dispatches on.

## Acceptance

`generate_image` with a prompt produces a placeholder asset that goes
`generating → downloading → none` and imports a real image. Then test with a reference image
in `imageURLs`.
