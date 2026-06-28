# 07 — Env-gated features: graceful degradation when provider keys are missing

Surface **per-capability availability** to the macOS client so a partially-configured backend
(e.g. `XAI_API_KEY` set, `FAL_KEY` absent) hides or disables only the affected generation
features instead of gating all AI off. Depends on `00`–`06`. The only Swift type change is one
additive optional field on `CatalogEntry`; the function surface is otherwise unchanged.

This is a *visibility* change, not a routing change. Adapters already throw descriptive errors on
missing keys (`xaiKey()` → `"XAI_API_KEY not configured"`). The work is to (a) compute which keys
are present in `models:list`, (b) mark unavailable catalog entries, (c) have Swift hide/disable
them with terse copy, and (d) keep boot health (`isMisconfigured`) decoupled from provider keys.

---

## 1. Problem statement

`aiAllowed = isSignedIn && !isMisconfigured` (`AccountService.swift:114`) is binary. It is driven
only by Clerk + Convex URL presence (`configure()` at `AccountService.swift:141`), so provider
keys do **not** currently flip it — which is correct for boot. The real problem is downstream:

- **No signal reaches the UI about which providers are configured.** Every catalog entry from
  `models:list` (`backend/convex/models.ts:314`) is rendered as selectable regardless of whether
  its provider key exists. `ModelCatalog.apply` (`ModelCatalog.swift:69`) splits all entries into
  pickers unconditionally.
- **Failure is discovered at submit time only (worst UX).** A user on a FAL-less deployment can
  pick `lyria3-pro`, fill the form, spend the round-trip, and only then see the job flip to
  `failed` with `errorMessage: "FAL_KEY not configured"` (`generations.ts:170` catch →
  `setFailed`). The agent path is the same: `ToolExecutor+Generate.swift` gates on `isSignedIn` +
  `hasCredits` but never on capability, so the model returns a stack-trace-y tool error.
- **One missing key looks like "everything is broken."** With only `XAI_API_KEY` set, image /
  video / TTS work, but music + upscale silently fail. There is no honest "Music needs a music
  provider" state.

**Goal:** each generation capability (image, video, TTS, music, video-to-music, upscale, and per
selectable model) is marked available/unavailable based on configured env keys, surfaced
reactively to the client, and presented with terse Palmier-voice copy. The editor still opens and
all non-generative tools still work with zero keys.

---

## 2. Backend design options

| | Approach | Pros | Cons |
|---|---|---|---|
| **A** | New/extended `account:get` → `{ providers: { xai, openai, fal, elevenlabs }, unavailableModels: string[] }` | One coarse object; easy to read | A second source of truth that must stay in sync with the catalog's model→provider mapping; duplicates routing knowledge already in `image.ts`/`video.ts`/`audio.ts`; `account:get` is auth-gated so unauthenticated UI can't preview availability |
| **B** | **Catalog-driven**: `models:list` marks each entry `available: boolean` + `unavailableReason?: string` when its provider key is missing | Catalog is already the single source of truth (the `06` pivot explicitly chose "model id → provider, catalog is the single source of truth", `06`-§2.3). Per-capability availability falls out for free. Reactive — already subscribed (`ModelCatalog.swift:53`). One additive optional field; Swift `Decodable` tolerates it. Works pre-auth (the query is static/public). | Need a single `MODEL_PROVIDER` map in the backend (small, lives next to the catalog) |
| **C** | Fail only at submit | No new code | Worst UX — late rejection, wasted form-fill, stack-trace errors. This is today's behavior. |

### Recommendation: **B (catalog-driven), with a small derived layer in Swift.**

`models:list` is already the contract that builds every picker; availability is a property of a
model, so it belongs on the catalog entry. Add one backend map of model id → required env var,
compute `available`/`unavailableReason` in the `list` handler from `process.env`, and let Swift
derive coarse per-kind flags (`imageAllowed`, etc.) from the filtered catalog. **Do not** add
provider booleans to `account:get` (Option A) — it would duplicate the routing map and split the
source of truth. Keep `account:get` about identity/credits only.

Keep submit-time validation as the **safety net** (defense in depth): even with B, `submit`/the
provider adapters must still reject a missing-key model with a clean, user-friendly error in case
the catalog and runtime ever disagree (key revoked mid-session — see §8).

---

## 3. Env → capability mapping table

Derived from the adapter dispatch in `image.ts:46`, `video.ts` (`runVideoAdapter`), `audio.ts:40`,
`upscale.ts`, and the key helpers (`xaiKey`/`openaiKey`/`falKey`/elevenlabs key).

| Model id | Kind / capability | Required env var | Notes |
|---|---|---|---|
| `grok-imagine-image-quality` | image (default) | `XAI_API_KEY` | Auto-fallback to `gpt-image-2` only on **retryable** x.ai errors (429/5xx/timeout), **not** on a missing key — `isRetryableImageError` (`image.ts:73`) returns false for `"XAI_API_KEY not configured"`. See decision below. |
| `gpt-image-2` | image (secondary) | `OPENAI_API_KEY` | Independent entry; works whenever OpenAI is set. |
| `nano-banana-pro` | image (tertiary) | `FAL_KEY` | |
| `grok-imagine-video` | video (default t2v/i2v/ref2v) | `XAI_API_KEY` | Delegates x.ai-incompatible combos (end-frame, ref video/audio) to `seedance-2.0-fast` → needs **`FAL_KEY` too** for those specific combos. Mark available if `XAI_API_KEY` present; the delegated combos fail cleanly if FAL is absent. |
| `grok-imagine-video-1.5` | video (i2v 1080p) | `XAI_API_KEY` | |
| `seedance-2.0-fast` | video (tertiary + delegation target) | `FAL_KEY` | |
| `grok-tts` | audio / TTS (default) | `XAI_API_KEY` | |
| `elevenlabs-tts-v3` | audio / TTS (secondary) | `ELEVENLABS_API_KEY` | |
| `lyria3-pro` | audio / music | `FAL_KEY` | |
| `sonilo-v1.1-video-to-music` | audio / video-to-music | `FAL_KEY` | |
| `seedvr-image-upscaler` | upscale (image) | `FAL_KEY` | |
| `bytedance-upscaler` | upscale (video) | `FAL_KEY` | |

**XAI missing but OPENAI present — does image still work?** Yes, via the **`gpt-image-2` entry**
(it has its own `OPENAI_API_KEY` gate). But the **default** `grok-imagine-image-quality` entry
will be marked unavailable, and its current fallback does **not** trigger on a missing key.

> **Decision (image default + fallback):** When `XAI_API_KEY` is absent but `OPENAI_API_KEY` is
> present, mark `grok-imagine-image-quality` **unavailable** and let `gpt-image-2` become the
> first available image entry (so the picker still defaults to a working image model). Do **not**
> silently reroute the grok id to OpenAI. Optionally (small, recommended) also extend
> `isRetryableImageError` / `withImageFallback` so a missing-`XAI_API_KEY` runtime error *does*
> fall back to OpenAI — but the catalog flag is the primary fix; the fallback tweak is only a
> mid-session-revocation safety net.

`CLERK_JWT_ISSUER_DOMAIN` gates **auth**, not a capability — its absence is a boot/deploy problem
(no users can sign in), surfaced through Clerk, never as a per-model flag.

---

## 4. Swift frontend UX

### `aiAllowed`: keep binary, add catalog-derived granular flags

`aiAllowed` is about *sign-in + deployment health* and should stay binary. Provider-key
availability is a separate axis and should be **derived from the catalog**, not folded into
`aiAllowed`. Add computed flags to `ModelCatalog` (the natural owner — it already holds the split
arrays):

```swift
// ModelCatalog.swift — derived from the `available` flag on each entry
var availableImage: [ImageModelConfig] { image.filter(\.isAvailable) }
var availableVideo: [VideoModelConfig] { video.filter(\.isAvailable) }
var availableAudio: [AudioModelConfig] { audio.filter(\.isAvailable) }
var availableUpscale: [UpscaleModelConfig] { upscale.filter(\.isAvailable) }

var imageAllowed: Bool { !availableImage.isEmpty }
var videoAllowed: Bool { !availableVideo.isEmpty }
// audio is two capabilities — split by AudioCaps.category
var ttsAllowed: Bool { availableAudio.contains { $0.category == "tts" } }
var musicAllowed: Bool { availableAudio.contains { $0.category == "music" } }
var upscaleAllowed: Bool { !availableUpscale.isEmpty }
```

The effective gate for a generation type becomes
`account.aiAllowed && ModelCatalog.shared.<kind>Allowed`.

### Where to surface unavailability

| Surface | Behavior |
|---|---|
| **Model picker** (`GenerationView`, AIEditMenu, MusicTab) | Default to filtered `available*` lists. Optionally still list unavailable models **disabled** with a one-line reason on hover (`.help`) so users learn what a key would unlock — but never preselect one. |
| **Type picker / generate buttons** | When a whole capability is unavailable, disable its submit affordance and show the reason inline, mirroring the existing `submitButton` pattern (`GenerationView.swift:1297` already does `.disabled` + `.help` + opacity for the sign-in case). |
| **Agent / MCP tools** | `ToolExecutor+Generate.swift` adds a capability guard *before* model selection, throwing a `ToolError` the model can relay (see below). |
| **Settings / Account** | A read-only "Providers" section listing each capability and whether it's configured — useful for the operator running a self-hosted deployment. Low priority (Wave C). |

### Copy / voice (AGENTS.md — terse, direct, action-first)

- Capability off: **"Music unavailable. No music provider configured."**
- Model row disabled: **"Needs FAL_KEY"** / **"Needs OPENAI_API_KEY"** (operator-facing, terse).
- Submit attempt blocked: **"Upscaling unavailable on this backend."**
- Agent tool error (model-facing, so it can relay plainly):
  **"Music generation is unavailable on this backend (no music provider configured). Tell the
  user music isn't available."**

No marketing, no "Oops", no exclamation. State the thing, then the reason.

### Agent / MCP tool behavior

In `ToolExecutor+Generate.swift`, after the existing `isSignedIn` / `hasCredits` guards and once
the kind is known, add:

```swift
guard ModelCatalog.shared.<kind>Allowed else {
    throw ToolError("<Capability> is unavailable on this backend. Tell the user it isn't configured.")
}
```

This converts the late `"FAL_KEY not configured"` stack-trace into an early, plain refusal the LLM
can paraphrase. The same `ModelCatalog` flags back both the in-app chat and the MCP server (they
share one `ToolExecutor`, per AGENTS.md).

---

## 5. Boot vs lazy checks

**Must work with zero provider keys (never gated by them):**

- `models:list` — now *reads* `process.env.*` to compute `available`, but still returns the full
  catalog. Reading env in a query is fine and side-effect-free.
- `account:get`, `users:upsertFromAuth`, `billing:listPlans`, `uploads:generateUploadTicket` /
  `recordUpload` / `commitUpload` — none touch provider keys.

**`isMisconfigured` must remain about a *truly broken* deployment only** — missing
`clerkPublishableKey` or `convexDeploymentURL` (`AccountService.swift:141`). **Do not** add
provider-key checks to `isMisconfigured`; a backend with Clerk + Convex but no `FAL_KEY` is a
healthy deployment with reduced capabilities, not a misconfigured one.

**Lazy / submit-time (safety net):** provider adapters keep throwing on missing keys; `process`
keeps catching → `setFailed`. Optionally add an early `submit`-time check that rejects a model
whose key is absent with a clean message, so the failure is synchronous on the mutation rather
than appearing later on the job subscription.

---

## 6. Implementation phases

Zero over-engineering: one backend map + one optional field, one Swift field + derived flags, then
wire the surfaces.

**Wave A — backend availability (serial, lands first).**
- [ ] `backend/convex/models.ts`: add a `MODEL_REQUIRED_ENV: Record<string, "XAI_API_KEY" |
      "OPENAI_API_KEY" | "FAL_KEY" | "ELEVENLABS_API_KEY">` map (one entry per catalog id, mirrors
      §3). Add `available: boolean` and `unavailableReason?: string` to `CatalogEntry`. In the
      `list` handler, compute them from `process.env[MODEL_REQUIRED_ENV[id]]`.
- [ ] (Optional, recommended) `generations.ts` `submit`: reject a model whose required key is
      absent with `throw new Error("<Model> is unavailable: <ENV_VAR> not configured")`.
- [ ] (Optional) `image.ts`: extend `isRetryableImageError` (or `withImageFallback`) so a missing
      `XAI_API_KEY` falls back to `gpt-image-2` when OpenAI is configured (mid-session safety net).

**Wave B — Swift catalog plumbing (after A).**
- [ ] `ModelCatalog.swift` `CatalogEntry`: decode optional `available` (default `true`) and
      `unavailableReason`. Thread `isAvailable` / `unavailableReason` onto each `*ModelConfig`.
- [ ] Add `availableImage/…`, `imageAllowed/videoAllowed/ttsAllowed/musicAllowed/upscaleAllowed`
      derived properties.

**Wave C — surface wiring (after B; pickers are independent, can parallelize).**
- [ ] `GenerationView.swift`: source pickers from `available*`; gate `submitButton` per-kind with
      reason copy; (optional) render disabled unavailable rows with `.help`.
- [ ] `ToolExecutor+Generate.swift`: add per-capability guards in `generateMedia` / `generateAudio`
      / upscale paths.
- [ ] `MusicTab.swift`, `AIEditMenu.swift` / `AIEditTab.swift`: same filtering + reason copy.
- [ ] (Optional) `SettingsView.swift`: read-only Providers status section.

Disjoint files in C → safe for parallel subagents.

---

## 7. Acceptance criteria

- [ ] **Only `XAI_API_KEY` set** — image (`grok-imagine-image-quality`), video (`grok-imagine-video`,
      `-1.5`), and TTS (`grok-tts`) work; music, video-to-music, and upscale are hidden (or disabled
      with a clear reason); `gpt-image-2`, `nano-banana-pro`, `elevenlabs-tts-v3` likewise.
- [ ] **`XAI` absent, `OPENAI` present** — image still works because the picker defaults to the
      available `gpt-image-2`; `grok-imagine-image-quality` is shown unavailable, not selected.
- [ ] **No provider keys** — editor opens; the app is **not** `isMisconfigured`; sign-in works; all
      generative pickers show "unavailable" states and no generation can be submitted; non-generative
      agent/MCP tools still run.
- [ ] **Submit a missing-key model anyway** (catalog/runtime disagreement) — user sees a friendly
      error ("… unavailable: FAL_KEY not configured"), never a raw stack trace; job ends `failed`
      cleanly.
- [ ] **Agent path** — asking the chat to generate an unavailable capability yields a plain refusal
      the model relays, not a thrown internal error.
- [ ] **No Swift type breakage** — `CatalogEntry` change is additive/optional; a backend that omits
      `available` still decodes (defaults to available).

---

## 8. Edge cases

1. **Key present at boot but revoked mid-session.** Catalog flag was `true`; the adapter now throws
   at runtime. The submit-time net + `setFailed` produce a clean error; the operator's next
   `models:list` re-eval (or a manual env change + redeploy) flips the flag. The optional image
   fallback covers the image case gracefully. Don't try to live-detect revocation — KISS.
2. **Partial fal.** All fal models share one `FAL_KEY`; there is no per-model fal sub-key. So FAL
   availability is all-or-nothing — `nano-banana-pro`, `seedance-2.0-fast`, `lyria3-pro`,
   `sonilo-v1.1-video-to-music`, and both upscalers flip together on `FAL_KEY`. No per-model fal
   granularity needed.
3. **`grok-imagine-video` delegation needs FAL.** The x.ai default video model is "available" with
   `XAI_API_KEY`, but end-frame / reference-video / reference-audio combos delegate to
   `seedance-2.0-fast` (FAL). Mark the model available on `XAI_API_KEY`; let the delegated combo
   fail cleanly with a reason if `FAL_KEY` is absent (don't over-model this in the flag — the
   capability is "video", and basic video works).
4. **Self-hosted storage URL reachability** is a **separate** concern from env keys — a job can
   succeed at the provider yet fail to re-host if Convex storage / the deployment URL is
   unreachable. **Note but do not conflate**: that surfaces as a runtime job error, not a
   capability flag. Out of scope for this plan.

---

## Summary

- **Plan path:** `docs/plans/07-env-gated-features.md`.
- **Key recommendation:** **Option B — make `models:list` mark each catalog entry `available` /
  `unavailableReason` from `process.env`** (single source of truth, reactive, additive Swift
  field), have Swift derive per-kind flags (`imageAllowed`, `ttsAllowed`, `musicAllowed`, …) and
  filter pickers + guard agent tools accordingly. Keep `aiAllowed` binary and keep
  `isMisconfigured` about Clerk/Convex only — provider keys never affect boot. Retain submit-time
  validation as a defense-in-depth net for mid-session key revocation.
