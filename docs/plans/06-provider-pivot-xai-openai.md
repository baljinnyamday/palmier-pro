# 06 — Provider pivot: x.ai-first, OpenAI-second

Re-point the self-hosted generation backend from **fal.ai-first** to **x.ai-first, OpenAI-second**,
keeping fal.ai only where x.ai/OpenAI have no equivalent. Depends on `00-foundation.md` and the
adapter scaffolding from `01`–`04`. **No Swift changes** — same Convex function surface, same
`CatalogEntry` shape, same `GenerationParams`/`ProviderResult` types.

This is a *re-wiring*, not a rewrite. The router (`routeToProvider`), re-hosting
(`ctx.rehostUrl` / `ctx.storeBytes`), and catalog query (`models:list`) stay on the current
backend shape. We swap which provider each model id dispatches to, add x.ai/OpenAI client modules,
and update catalog entries. The only non-provider work in this plan is an explicit stabilization
step for the existing async job lifecycle, because recent review found fal video upscales can exceed
the Convex action window and leave jobs stuck in `running`.

---

## 0. Why this pivot

- Plans `01`–`04` are fal-centric: `FAL_KEY`, `nano-banana-pro`, `seedance-2.0-fast`,
  `lyria3-pro`, `sonilo-v1.1-video-to-music`, fal upscalers.
- User has x.ai credits → x.ai is primary for image, video, TTS.
- OpenAI `gpt-image-2` is the secondary image provider (auto-fallback + selectable).
- x.ai has **no** music, video-to-audio/video-to-music, or upscale endpoints. fal.ai stays as the **only**
  provider for those three, and as an optional tertiary for video.

---

## 1. Provider priority matrix

| Kind | Primary (x.ai) | Secondary | Tertiary / fallback |
|---|---|---|---|
| **Image (t2i + edit)** | `grok-imagine-image-quality` (`POST /v1/images/generations`, `/v1/images/edits`) | OpenAI `gpt-image-2` (`POST /v1/images/generations`, `/v1/images/edits`) — auto-fallback on x.ai 5xx/timeout **and** user-selectable | fal `nano-banana-pro` — keep entry, deprecate as default |
| **Video (t2v / i2v / ref2v / edit)** | `grok-imagine-video` as the general default (t2v, i2v, reference-to-video, edit) + `grok-imagine-video-1.5` as a selectable 1080p **i2v-only** model | — (no drop-in secondary) | fal `seedance-2.0-fast` — keep entry as selectable tertiary and compatibility route for end-frame / video-ref / audio-ref combos |
| **Audio — TTS** | `grok-tts` (`POST /v1/tts`) | ElevenLabs `elevenlabs-tts-v3` (already built in `03`) — user-selectable | — |
| **Audio — music** | *(x.ai n/a)* | — | fal `lyria3-pro` — **unchanged**, still primary for music |
| **Audio — video-to-audio / video-to-music** | *(x.ai n/a)* | — | fal `sonilo-v1.1-video-to-music` — **unchanged** |
| **Upscale (image + video)** | *(x.ai n/a)* | *(OpenAI n/a)* | fal `seedvr-image-upscaler` / `bytedance-upscaler` — **unchanged** |

**Decision: keep `providers/fal.ts`.** It is load-bearing for music, video-to-audio, and upscale.
Removing it would drop three working capabilities for zero benefit (KISS/YAGNI). We only *demote*
fal for image/video by changing catalog defaults, not delete it.

x.ai model facts (from docs):

- `grok-imagine-image-quality`: Text,Image→Image. `resolution` `"1k"`/`"2k"`. Output pricing is
  flat per generated image in x.ai docs; edits are billed for both the input image and generated
  output. The response includes `usage.cost_in_usd_ticks` — prefer that for audit logging when
  available, but keep catalog credits as a static estimate until billing is finalized.
- `grok-imagine-image`: cheaper variant. Optional budget catalog entry if cost matters later.
- `grok-imagine-video`: Text,Image,Video→Video. Supports t2v, i2v, reference-to-video, edit, and
  extend. Use it as the default because it covers text-to-video with no conditioning assets.
- `grok-imagine-video-1.5`: image→video only, supports **1080p i2v**, and **does not** support
  reference-to-video. Aliases `grok-imagine-video-1.5-preview`. It is a specialized selectable
  model, not the default.
- `grok-tts` (`/v1/tts`): voices `eve` (default), `ara`, `rex`, `sal`, `leo`. Max 15,000 chars.
  Returns raw audio bytes (mp3 default).

---

## 2. Architecture changes

### 2.1 Module layout

Keep the per-kind adapter files (the isolation that made `01`–`04` parallelizable). Add **shared
provider client modules** alongside `fal.ts`:

```
backend/convex/providers/
  router.ts            # same ProviderContext signature; video case calls runVideoAdapter
  types.ts             # unchanged
  fal.ts               # KEEP — falSubscribe / falQueueRun / falFileUrl (music, v2a, upscale, fal video/image fallback)
  xai.ts               # NEW — shared x.ai REST client (image, video start/poll, tts)
  openaiImage.ts       # NEW — shared OpenAI Images client (gpt-image-2 generations + edits)
  image.ts             # EDIT — dispatch grok-imagine-image-quality | gpt-image-2 | nano-banana-pro
  video.ts             # NEW file (replaces seedanceVideo.ts as the entry) — dispatch grok video | seedance
  seedanceVideo.ts     # KEEP — fal video impl, called by video.ts for the seedance tertiary id
  audio.ts             # EDIT — add grok-tts branch; keep elevenlabs/lyria/sonilo branches
  upscale.ts           # unchanged
```

Rename note: `02` implemented video directly as `runSeedanceVideo`. To host multi-provider video
dispatch cleanly, introduce `video.ts` with `runVideoAdapter(model, params, ctx)` and have it call
either the x.ai path (in `xai.ts`) or `runSeedanceVideo` (kept in `seedanceVideo.ts`). The router's
`videoAdapter` then calls `runVideoAdapter` instead of switching inline.

### 2.2 Shared client patterns

`xai.ts` exposes thin REST helpers, mirroring `fal.ts` conventions (read key from env, throw on
missing, `fetch`, surface body text on non-2xx):

```ts
// backend/convex/providers/xai.ts
const XAI_BASE = "https://api.x.ai/v1";
function xaiKey(): string { /* process.env.XAI_API_KEY or throw */ }

export async function xaiImages(
  path: "generations" | "edits",
  body: Record<string, unknown>,
): Promise<XaiImageResponse>;                       // POST /v1/images/{path}, JSON

export async function xaiVideoStart(
  path: "generations" | "edits" | "extensions",
  body: Record<string, unknown>,
): Promise<string>;                                  // returns request_id

export async function xaiVideoPoll(
  requestId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<{ url: string; duration: number }>;       // GET /v1/videos/{id} until done/failed/expired

export async function xaiTts(
  body: Record<string, unknown>,
): Promise<ArrayBuffer>;                              // POST /v1/tts, raw audio bytes
```

`openaiImage.ts` uses raw `fetch` + `FormData` instead of adding the OpenAI SDK dependency:

```ts
// backend/convex/providers/openaiImage.ts
const OPENAI_BASE = "https://api.openai.com/v1";
function openaiKey(): string { /* process.env.OPENAI_API_KEY or throw */ }

export async function openaiImageGenerate(body: Record<string, unknown>): Promise<OpenAiImageResponse>;
export async function openaiImageEdit(body: Record<string, unknown>): Promise<OpenAiImageResponse>;
// gpt-image-2 returns b64_json by default → caller storeBytes; no rehost hop needed.
```

### 2.3 Router dispatch strategy

**Model id → provider** (Option A), preserving the existing explicit switch style. Each catalog
`id` binds to exactly one concrete provider model. This keeps the catalog the single source of
truth, keeps Swift untouched, and avoids a hidden routing layer.

**Plus one targeted resilience fallback for image only.** Image is the only kind with a true
drop-in secondary, and the user explicitly wants OpenAI as image fallback. In `image.ts`, when the
selected model is the x.ai primary and x.ai throws a **retryable** error (HTTP 429/5xx or timeout),
retry once against `gpt-image-2`, then surface the error if that also fails. Implement as a small
`withImageFallback(primary, secondary)` helper — no generic chain framework (YAGNI). Video and
audio do **not** auto-fallback (no equivalent secondary); their secondary/tertiary options are
separate user-selectable catalog ids.

```ts
// router.ts — only the video case changes shape
async function videoAdapter(model, params, ctx) {
  if (params.kind !== "video") throw new Error("Expected video params");
  return runVideoAdapter(model, params, ctx);   // video.ts owns id dispatch
}
```

### 2.4 Env vars

`backend/.env.example` becomes:

```bash
# Clerk JWT issuer (Frontend API URL from Clerk dashboard)
CLERK_JWT_ISSUER_DOMAIN=https://your-app.clerk.accounts.dev

# x.ai — primary for image, video, TTS
XAI_API_KEY=
# OpenAI — secondary image provider (gpt-image-2)
OPENAI_API_KEY=
# fal.ai — music, video-to-music, upscale, and optional image/video fallback
FAL_KEY=
# ElevenLabs — optional secondary TTS (kept from plan 03)
ELEVENLABS_API_KEY=
```

Set the same keys in the Convex deployment env (`npx convex env set XAI_API_KEY ...`). **No secrets
in code** — every key is read via `process.env.*` at call time and throws if absent (matches
`falKey()`).

---

## 3. Catalog / model id strategy (`models.ts`)

Catalog ordering matters: the Swift pickers list entries in array order, so **primary models go
first per kind** to become the default selection. No `CatalogEntry` field changes.

### New / changed entries (in this order)

**Image**
1. `grok-imagine-image-quality` — **new default image**. `creditsPerImage: { "1K": 5, "2K": 5 }`
   (placeholder; x.ai image-quality output is currently documented as flat per generated image, with
   edit requests billing input + output). `uiCapabilities`:
   `resolutions: ["1K","2K"]`, `aspectRatios: ["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]`,
   `qualities: ["standard"]`, `supportsImageReference: true`, `maxImages: 4`.
2. `gpt-image-2` — secondary. `creditsPerImage` stays a **static estimate** because the catalog
   cannot express token-based image input/output billing. Seed conservative placeholder buckets such
   as `{ "1024x1024": <n>, "1536x1024": <n>, "1024x1536": <n>, "2560x1440": <n> }` and mark
   `// TODO pricing: replace after OpenAI calculator pass`. `supportsImageReference: true` (edits),
   `maxImages: 4` for UI consistency even though the API can accept more reference images.
3. `nano-banana-pro` — **keep**, demoted below the x.ai/OpenAI entries.

**Video**
1. `grok-imagine-video` — **new default video** for t2v / i2v / reference-to-video / edit.
   `creditsPerSecond: { "480p": 5, "720p": 7 }` (placeholder). `supportsFirstFrame: true`,
   `supportsLastFrame: false`, `maxReferenceImages: 3`, `maxReferenceVideos: 0`,
   `maxReferenceAudios: 0`, `requiresSourceVideo: false`. It must remain first because it can
   satisfy a bare text prompt.
2. `grok-imagine-video-1.5` — specialized selectable i2v model that can reach 1080p.
   `creditsPerSecond: { "480p": 5, "720p": 7, "1080p": 8 }` (placeholder).
   `uiCapabilities`: `durations: [5,10,15]`, `resolutions: ["480p","720p","1080p"]`,
   `aspectRatios: ["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]`,
   `supportsFirstFrame: true`, `supportsLastFrame: false`, `maxReferenceImages: 0`,
   `maxReferenceVideos: 0`, `maxReferenceAudios: 0`, `requiresSourceVideo: false`.
3. `seedance-2.0-fast` — **keep** as fal tertiary, demoted.

**Audio**
1. `grok-tts` — **new default TTS**. `audioPricing: { mode: "perThousandChars", rate: <n> }`
   (placeholder). `uiCapabilities`: `category:"tts"`, `voices: ["eve","ara","rex","sal","leo"]`,
   `defaultVoice:"eve"`, `supportsStyleInstructions: true` (via inline speech tags / prepended
   instructions), `minPromptLength: 1`, `inputs:["text"]`, `promptLabel:"Text to speak"`.
2. `elevenlabs-tts-v3` — **keep**, demoted to secondary TTS.
3. `lyria3-pro` — **unchanged** (music, fal).
4. `sonilo-v1.1-video-to-music` — **unchanged** (video-to-music, fal).

**Upscale** — both entries **unchanged** (`seedvr-image-upscaler`, `bytedance-upscaler`, fal).

### Credit placeholders

Pick one constant `CREDITS_PER_DOLLAR` (suggest **100**, i.e. 1 credit = $0.01, consistent with
existing `nano-banana-pro` 2K = 8 credits) and derive all new numbers from current x.ai/OpenAI
pricing pages. For x.ai image responses, capture `usage.cost_in_usd_ticks` in debug logs only if
useful; do not change the public job shape. For OpenAI `gpt-image-2`, pricing is token-based
(text input + image input for edits + image output), so catalog credits are intentionally estimates
until a pricing calculator pass finalizes them. Mark every new number as `// TODO pricing`. Do not
block implementation on exact numbers.

---

## 4. API mapping per adapter

### 4.1 Image — `image.ts`

`ImageParams { prompt, aspectRatio, resolution?, quality?, imageURLs?, numImages }`.

**x.ai `grok-imagine-image-quality`** — `hasRefs = imageURLs?.length > 0`.

| PalmierPro | x.ai generations | x.ai edits |
|---|---|---|
| `prompt` | `prompt` | `prompt` (ref multi-image as `<IMAGE_0>`,`<IMAGE_1>`,… when 2–3 refs) |
| `aspectRatio` | `aspect_ratio` (`"16:9"` etc.; `auto` allowed) | `aspect_ratio` (multi-image only; single-ref output inherits input AR) |
| `resolution`/`quality` | `resolution`: map `"2K"→"2k"`, else `"1k"` | same |
| `numImages` | `n` (≤10) | `n` |
| `imageURLs` | — (t2i) | 1 ref → `image: { url }`; 2–3 refs → `images: [{ url }, …]` |
| — | `response_format: "b64_json"` | `response_format: "b64_json"` |

- Endpoint: refs present → `POST /v1/images/edits`; else `POST /v1/images/generations`.
- Supported AR strings include the current UI set plus x.ai's wider set (`"2:1"`, `"1:2"`,
  `"19.5:9"`, `"9:19.5"`, `"20:9"`, `"9:20"`, `"auto"`). Do not expose new ARs unless Swift
  already renders arbitrary catalog strings cleanly; the backend can pass through any catalog value.
- **JSON only** for edits (the OpenAI SDK `images.edit()` multipart path is unsupported). We pass
  Convex storage **public HTTPS URLs** in `image.url` — no file upload needed.
- Result: decode each `b64_json` → `ctx.storeBytes(bytes, "image/png")`. (Avoids the short-lived-URL
  re-host hop; `response_format:"url"` + `ctx.rehostUrl` also works.)
- `costCredits`: `creditsPerImage[resolution] * numImages`.

**OpenAI `gpt-image-2`** (secondary, same `ImageParams`):

| PalmierPro | gpt-image-2 |
|---|---|
| `prompt` | `prompt` |
| `aspectRatio` | `size` (map AR → valid `WIDTHxHEIGHT`; both edges divisible by 16, max ratio 3:1, max pixels/edge within OpenAI limits) |
| `quality` | `quality` (`"low"`/`"medium"`/`"high"`) |
| `numImages` | `n` |
| `imageURLs` | edits: download each URL → multipart `image[]` (OpenAI edits **is** multipart) |

- Endpoint: refs → `POST /v1/images/edits` (multipart form-data, fetch the URLs to bytes first);
  else `POST /v1/images/generations` (JSON). gpt-image-2 returns `b64_json` → `storeBytes`.
- Note the asymmetry: **x.ai edits = JSON+URL, OpenAI edits = multipart+bytes.** Keep each in its
  own client module so the difference stays isolated.
- Start with conservative size mappings that keep outputs predictable in the existing UI:
  `1:1→1024x1024`, `16:9→1536x864` or `1536x1024`, `9:16→864x1536` or `1024x1536`,
  `4:3→1536x1152`, `3:4→1152x1536`, `3:2→1536x1024`, `2:3→1024x1536`.
  `gpt-image-2` can accept many more valid sizes, but do not expose a general size picker in this
  backend-only pivot.
- Do **not** pass unsupported knobs such as `input_fidelity` or transparent backgrounds. Keep
  `output_format` default unless we explicitly want JPEG/WebP later.

### 4.2 Video — `video.ts`

`VideoParams { prompt, duration, aspectRatio, resolution?, sourceVideoURL?, startFrameURL?,
endFrameURL?, referenceImageURLs?, referenceVideoURLs?, referenceAudioURLs?, generateAudio }`.

x.ai mode is chosen by the selected catalog model plus which fields are set (exactly one mode per
request). This matters because `grok-imagine-video-1.5` is not a general replacement for
`grok-imagine-video`.

| PalmierPro condition | x.ai mode | Endpoint | Model | Body |
|---|---|---|---|---|
| selected `grok-imagine-video`, `sourceVideoURL` set | edit-video | `POST /v1/videos/edits` | `grok-imagine-video` | `{ model, prompt, video:{ url } }` |
| selected `grok-imagine-video`, extension-specific model id later | extend-video | `POST /v1/videos/extensions` | `grok-imagine-video` | `{ model, prompt, video:{ url } }` |
| selected `grok-imagine-video-1.5`, `startFrameURL` set, no refs/source | high-quality image-to-video | `POST /v1/videos/generations` | `grok-imagine-video-1.5` | `{ model, prompt, image:{ url }, duration, resolution, aspect_ratio? }` |
| selected `grok-imagine-video`, `startFrameURL` set (no refs) | image-to-video | `POST /v1/videos/generations` | `grok-imagine-video` | `{ model, prompt, image:{ url }, duration, resolution, aspect_ratio? }` |
| `referenceImageURLs` set (no start frame) | reference-to-video | `POST /v1/videos/generations` | `grok-imagine-video` | `{ model, prompt, reference_images:[{url},…] }` |
| none of the above | text-to-video | `POST /v1/videos/generations` | `grok-imagine-video` | `{ model, prompt, duration, resolution, aspect_ratio }` |

Field mapping:

| PalmierPro | x.ai | Notes |
|---|---|---|
| `prompt` | `prompt` | required for t2v/ref2v/edit/extend; optional for i2v |
| `duration` | `duration` | 1–15; **edit/extend ignore it** (output keeps source duration, ≤8.7s) |
| `aspectRatio` | `aspect_ratio` | i2v defaults to input image AR; edit ignores it |
| `resolution` | `resolution` | `480p`/`720p`/`1080p`; **1080p only on 1.5 i2v**; edit caps at 720p |
| `startFrameURL` | `image:{ url }` | single starting frame only |
| `endFrameURL` | — | **unsupported on x.ai** (see Gaps); clear error on Grok, Seedance only when explicitly selected |
| `referenceImageURLs` | `reference_images:[{url}]` | requires `grok-imagine-video`, **not** 1.5; mutually exclusive with `image` |
| `referenceVideoURLs`/`referenceAudioURLs` | — | unsupported on x.ai; clear error on Grok, Seedance only when explicitly selected |
| `generateAudio` | — | no REST flag; 1.5 includes audio natively (note in Gaps) |

- **Async**: `xaiVideoStart(...)` → `request_id`, then `xaiVideoPoll(request_id)` loops
  `GET /v1/videos/{request_id}` until `status==="done"` (returns `video.url`, `video.duration`),
  throwing on `failed`/`expired` with `error.code`/`error.message`. Same shape as `falSubscribe`.
- **Re-host**: x.ai video URLs are temporary → `ctx.rehostUrl(video.url)`.
- `costCredits`: `creditsPerSecond[resolution] * effectiveDuration` (use `video.duration` from the
  poll result for edit/extend where input duration is unknown).
- Validation: reject `endFrameURL`, `referenceVideoURLs`, `referenceAudioURLs`, and
  `referenceImageURLs` + `startFrameURL` together with clear errors when the chosen model can't do
  it; **Decision: clear error on Grok** — user must explicitly select `seedance-2.0-fast` (requires
  `FAL_KEY`) for x.ai-incompatible combos. No silent Grok→Seedance delegation.
- `grok-imagine-video-1.5` validation is strict: require `startFrameURL`, reject
  `sourceVideoURL`, `endFrameURL`, and all reference arrays. If the user selects 1.5 for a plain text
  prompt, fail fast with "Grok Imagine Video 1.5 requires a start frame" instead of silently routing
  to a different provider model.
- x.ai video extension is documented, but current `VideoParams` has no separate "extend" intent.
  Preserve the **zero Swift changes** constraint by not exposing extension in the initial pivot.
  If extension is desired later without Swift changes, add a separate catalog id such as
  `grok-imagine-video-extend` and dispatch `sourceVideoURL` to `/v1/videos/extensions` only for
  that id.

### 4.3 Audio — `audio.ts`

`AudioParams { prompt, voice?, lyrics?, styleInstructions?, instrumental, durationSeconds?, videoURL? }`.

**x.ai `grok-tts`** (new TTS branch):

| PalmierPro | x.ai `/v1/tts` |
|---|---|
| `prompt` | `text` (≤15,000 chars; reject longer) |
| `voice` | `voice_id` (default `eve`; case-insensitive; validate against caps `voices`) |
| `styleInstructions` | prepend to `text`, or rely on inline speech tags `[pause]`,`<whisper>…</whisper>` |
| — | `language: "auto"` (or expose later) |
| — | `output_format: { codec:"mp3", sample_rate:24000, bit_rate:128000 }` |

- Returns **raw audio bytes** → `ctx.storeBytes(arrayBuffer, "audio/mpeg")` (same as
  `elevenLabsTts`). Do **not** set `with_timestamps` (keeps response = raw bytes, not JSON).
- `costCredits`: `audioPricing.perThousandChars` → `rate * ceil(chars/1000)` (reuse existing
  `computeCostCredits`).
- **Music** (`lyria3-pro`) and **video-to-audio/video-to-music** (`sonilo-v1.1-video-to-music`): **unchanged**,
  still fal (`falLyriaMusic`, `falSoniloVideoToMusic`). x.ai/OpenAI cover neither.
- Add `"grok-tts"` to the `AUDIO_MODELS` set and a `case "grok-tts": resultUrl = await xaiTts(...)`
  branch in `runAudioAdapter`.

### 4.4 Upscale — `upscale.ts`

`UpscaleParams { sourceURL, durationSeconds }`. **No provider pivot.** Neither x.ai nor OpenAI
offers an upscale endpoint. Keep `seedvr-image-upscaler` (image) and `bytedance-upscaler` (video) on
fal. Document this as an intentional fal dependency.

Do still fix the existing timeout hole before or alongside this pivot: `bytedance-upscaler` currently
allows `timeoutMs: 900_000`, which is longer than Convex's roughly 10-minute action limit. Cap fal
upscale polling below the action budget (target 8 minutes, leaving time for result download +
`ctx.rehostUrl`) or split long-running upscale into a durable submit/poll state machine that persists
the fal `request_id`. For plan 06, choose the smaller scoped fix: lower the adapter timeout and fail
cleanly instead of risking a platform-killed action.

---

## 5. Async / polling patterns

- **Image (x.ai + OpenAI)**: synchronous request/response. Prefer `response_format:"b64_json"`
  (x.ai) / default b64 (gpt-image-2) → `ctx.storeBytes` directly; no second network hop, no
  expiring URLs.
- **Video (x.ai)**: async two-step. `xaiVideoStart` → `request_id`; `xaiVideoPoll` loops
  `GET /v1/videos/{request_id}` on a fixed interval until `done`. Model after `falSubscribe`:
  `intervalMs ≈ 3000`, `timeoutMs` sized to stay **within the Convex action execution limit**
  (target ≤ 8 minutes for provider polling; leave the rest of the ~10-minute action window for
  submit overhead, result download, and Convex storage). Surface a clear "provider timed out — retry"
  error past that. The whole wait stays inside
  `generations.process` (`internalAction`), exactly like Seedance today.
- **TTS (x.ai)**: synchronous; bytes in the response body.
- **Re-hosting to Convex storage is unchanged and still required** for every kind: video via
  `ctx.rehostUrl(video.url)`; images/audio via `ctx.storeBytes(...)`. The `process` action already
  provides both. x.ai/OpenAI URLs are temporary, so nothing leaves Convex storage unhosted.
- **Failure mapping**: x.ai video `status:"failed"` carries `error.code`
  (`invalid_argument`/`failed_precondition`/`service_unavailable`/`internal_error`/`permission_denied`)
  and `error.message` → throw `new Error(\`x.ai video failed: ${code}: ${message}\`)`; `process`
  already catches and writes `setFailed`, surfacing to the Swift client as the job error.

### 5.1 Existing job lifecycle fixes

Recent Bugbot findings are not caused by the provider pivot, but they are on the same async path and
should be fixed before adding x.ai video polling:

- **Upscale action timeout**: lower `bytedance-upscaler` polling from 900s to an action-safe budget
  (target 480s) so `process` reaches its catch block and writes `failed` instead of being killed by
  Convex.
- **Stuck `running` jobs**: `claimForProcessing` currently refuses already-running jobs forever.
  Add a backend-only recovery path that records `startedAt` / `updatedAt` or `leaseExpiresAt` on the
  generation row, then marks stale `running` jobs failed after the action budget expires. Do **not**
  blindly re-run provider calls unless the provider `request_id` is persisted, otherwise recovery can
  double-bill. A small `crons.ts` watchdog or scheduled internal action is enough; Swift ignores extra
  row fields, so this preserves the zero Swift changes constraint.
- **Scope decision**: plan 06 should include the timeout cap and stale-running watchdog as **Wave 0**
  stabilization. It should not attempt full durable provider-job resumption unless we choose to
  persist external request ids in a separate follow-up.

---

## 6. Implementation phases (wave structure, mirrors `00`→`01–04`→`05`)

**Wave 0 — async stabilization (land first, serial).** Required before adding another async video
provider.
- [ ] `providers/upscale.ts`: reduce `bytedance-upscaler.timeoutMs` to an action-safe value (target
      `480_000`) or introduce a shared `PROVIDER_ACTION_TIMEOUT_MS` constant.
- [ ] `generations.ts` / schema: add backend-only stale-running tracking (`startedAt` or
      `leaseExpiresAt`) and a watchdog path that marks jobs failed after the action budget.
- [ ] Confirm `setSucceeded` / `setFailed` ordering cannot leave a job stuck or overwrite a terminal
      state unexpectedly.

**Wave A — shared clients + catalog + env (land after Wave 0, serial).** One small PR; everything else
depends on it.
- [ ] `providers/xai.ts`: `xaiImages`, `xaiVideoStart`, `xaiVideoPoll`, `xaiTts`, `xaiKey`, response
      types. Pure REST, no adapter logic.
- [ ] `providers/openaiImage.ts`: `openaiImageGenerate`, `openaiImageEdit`, `openaiKey`.
- [ ] `models.ts`: add/reorder catalog entries per §3 (x.ai/OpenAI first, fal demoted; nothing
      deleted).
- [ ] `.env.example`: add `XAI_API_KEY`, `OPENAI_API_KEY`; keep `FAL_KEY`, `ELEVENLABS_API_KEY`.
- [ ] Type-check / `npx convex dev` boots; `models:list` returns the new catalog.

**Wave B — adapters (parallel after A, no cross-file collision).**
- [ ] **B1 Image** — `image.ts`: dispatch `grok-imagine-image-quality` (x.ai) /
      `gpt-image-2` (OpenAI) / `nano-banana-pro` (fal). Add `withImageFallback` x.ai→OpenAI.
- [ ] **B2 Video** — new `video.ts` with `runVideoAdapter`; mode selection per §4.2; delegate
      x.ai-incompatible combos to `runSeedanceVideo`. Update `router.ts` video case to call it.
- [ ] **B3 Audio** — `audio.ts`: add `grok-tts` branch + caps; keep elevenlabs/lyria/sonilo.
- [ ] **B4 Upscale** — no provider pivot; confirm fal entries remain wired and the Wave 0 timeout cap
      is covered by verification.

These touch disjoint files (`image.ts` / `video.ts`+`router.ts` / `audio.ts`) → safe to assign to
parallel subagents, same as `01`–`04`.

**Wave C — verification (serial, after B).**
- [ ] End-to-end per §8. Update `docs/plans/README.md` table with a row for `06` and flip the
      "primary provider" notes. Update `AGENTS.md` "Learned Workspace Facts" line about generation
      routing if desired.

---

## 7. Gaps & decisions for the user

1. **x.ai has no music / video-to-audio/video-to-music / upscale.** → Keep fal for `lyria3-pro`,
   `sonilo-v1.1-video-to-music`, `seedvr-image-upscaler`, `bytedance-upscaler`. **fal.ts is not
   removable.** (Recommended; no capability regression.)
2. **End-frame video (`endFrameURL`)** — x.ai i2v takes only a single starting `image`, no end
   frame. **Decision: reject with a clear error** on Grok models; user must explicitly select
   `seedance-2.0-fast` (requires `FAL_KEY`). No silent Grok→Seedance delegation.
3. **Reference video / reference audio** (`referenceVideoURLs`/`referenceAudioURLs`) — x.ai video
   doesn't accept them. Same decision: clear error on Grok; Seedance only when explicitly selected.
4. **`generateAudio` flag** — x.ai Imagine video has no documented REST toggle for audio. The flag
   becomes a no-op for x.ai (use the provider default; no silent-output discount); honor it only on
   the Seedance path. Confirm acceptable.
5. **Video extension** — x.ai supports `/v1/videos/extensions`, but current `VideoParams` has no
   separate extend intent. Default: do not expose extension in this backend-only pivot. Later option:
   add a separate catalog id (no Swift type change) if the existing UI can select it for source-video
   requests.
6. **gpt-image-2 sizes & pricing** are placeholders. Sizes are flexible within OpenAI constraints;
   pricing is token-based, not a confirmed flat per-image table. Confirm with the OpenAI pricing
   calculator before finalizing credits, and confirm the AR→size table.
7. **Credit ratio** — proposal: 1 credit = $0.01 (`CREDITS_PER_DOLLAR = 100`), consistent with the
   existing `nano-banana-pro` 2K = 8 credits. Confirm or override.
8. **Image fallback scope** — auto x.ai→OpenAI fallback for **image only**; video/audio fall back
   only via explicit user-selectable catalog ids (no silent provider switch). Confirm.
9. **`grok-imagine-image` budget variant** ($0.02/img) — add as a 4th image entry or skip? Default:
   skip for now (YAGNI); add later if cost matters.
10. **Async stabilization scope** — include timeout cap + stale-running watchdog in Wave 0. Do not
   build full durable provider-job resumption unless we decide to persist external request ids.
11. **Swift changes: zero.** Same function surface, `CatalogEntry` shape, and `GenerationParams`.
   The only user-visible change is which models appear (and which is default) in the pickers, driven
   entirely by `models.ts` ordering. No `ModelCatalog.swift` / `GenerationBackend.swift` edits.

---

## 8. Acceptance criteria

Per kind, against the self-hosted deployment with `XAI_API_KEY` + `OPENAI_API_KEY` set (FAL_KEY for
the fal-backed paths):

- [ ] **Image (x.ai t2i)** — `generate_image` with a prompt, model `grok-imagine-image-quality`:
      placeholder asset goes `generating → downloading → none`, real image imports.
- [ ] **Image (x.ai edit)** — re-run with a reference image (`imageURLs`): uses `/v1/images/edits`,
      JSON + storage URL, output imports.
- [ ] **Image (multi-ref)** — 2–3 refs with `<IMAGE_0>`/`<IMAGE_1>` in prompt compose correctly.
- [ ] **Image (OpenAI)** — select `gpt-image-2`: t2i and edit (multipart) both import.
- [ ] **Image fallback** — simulate x.ai 5xx/timeout on `grok-imagine-image-quality`; confirm
      automatic single retry on `gpt-image-2` succeeds.
- [ ] **Video (x.ai t2v)** — `grok-imagine-video` text prompt: submit → poll → `done`, MP4 re-hosted
      and imported.
- [ ] **Video (x.ai i2v)** — `grok-imagine-video-1.5` with `startFrameURL`, 1080p: imports.
- [ ] **Video (x.ai ref2v)** — `grok-imagine-video` with `referenceImageURLs`: imports.
- [ ] **Video (delegation)** — request with `endFrameURL` (or reference video/audio) routes to
      `seedance-2.0-fast` and still imports (no regression vs `02`).
- [ ] **TTS (x.ai)** — `generate_audio` model `grok-tts`, voice `eve`, with a speech tag
      (`[pause]`/`<whisper>`): MP3 imports; bad `voice_id` → clean error.
- [ ] **Music / video-to-audio** — `lyria3-pro` and `sonilo-v1.1-video-to-music` still work (fal).
- [ ] **Upscale** — image + video upscalers still work (fal).
- [ ] **Upscale timeout** — video upscale polling fails cleanly before the Convex action limit; no
      job remains indefinitely `running`.
- [ ] **Stale job watchdog** — simulate a job left in `running` past the action budget; watchdog marks
      it `failed` with a clear recovery message.
- [ ] **Credits** — `costCredits` is non-zero and plausible for each kind; user budget decrements.
- [ ] **No secrets in code** — all keys via `process.env.*`; missing key → descriptive throw, job
      `failed`, app surfaces the error.
- [ ] **No Swift changes** — app boots not `isMisconfigured`; pickers show x.ai models first.
