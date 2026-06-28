# Self-hosted generation backend — implementation plans

Goal: run our own backend for PalmierPro's four paid generation features
(`generate_video`, `generate_image`, `generate_audio`, `upscale_media`) plus the
account/upload plumbing the app needs at boot, so these features work without Palmier's
closed-source Convex backend. We pay AI providers directly.

## Approach: self-host Convex (Path A)

The macOS client does **not** speak plain HTTP to this backend. It uses the **ConvexMobile
SDK** with reactive subscriptions and a Clerk-JWT auth provider:

- `Sources/PalmierPro/Account/AccountService.swift:169` →
  `ConvexClientWithAuth(deploymentUrl:, authProvider: ClerkConvexAuthProvider())`
- `Sources/PalmierPro/Generation/GenerationBackend.swift` → `convex.mutation/action/subscribe`
- `Sources/PalmierPro/Generation/Catalog/ModelCatalog.swift:54` → `convex.subscribe("models:list")`

So we stand up our **own self-hosted Convex deployment**, implement the same functions, and
point `BackendConfig.convexDeploymentURL` at it. **Zero Swift changes.** Clerk stays (the
client refuses to configure without it), which doubles as the multi-user seam for later.

## Plan files (implement in order of dependency)

| # | File | What an agent builds |
|---|---|---|
| 0 | [`00-foundation.md`](./00-foundation.md) | Convex project, auth, schema, types, job lifecycle, all boot functions, router skeleton. **Land first.** |
| 1 | [`01-adapter-image.md`](./01-adapter-image.md) | `image` provider adapter |
| 2 | [`02-adapter-video.md`](./02-adapter-video.md) | `video` provider adapter |
| 3 | [`03-adapter-audio.md`](./03-adapter-audio.md) | `audio` provider adapter (tts / music / video-to-audio) |
| 4 | [`04-adapter-upscale.md`](./04-adapter-upscale.md) | `upscale` provider adapter |
| 5 | [`05-app-wiring.md`](./05-app-wiring.md) | Point the app at the deployment + end-to-end verification |
| 6 | [`06-provider-pivot-xai-openai.md`](./06-provider-pivot-xai-openai.md) | Pivot defaults to x.ai-first / OpenAI-second while keeping fal for music, video-to-music, upscale, and tertiary video/image fallback |
| 7 | [`07-env-gated-features.md`](./07-env-gated-features.md) | **Implemented.** Catalog-driven `available` / `unavailableReason` on `models:list`; Swift derives per-kind flags and gates pickers, submit, and agent tools when provider keys are missing |

`00` must compile and boot before any adapter is meaningful (it defines the shared
`providers/types.ts` and the `routeToProvider` signature). After that, `01`–`04` are
independent and can be done in parallel. `06` is an optional provider-priority pivot after
the fal-first adapters exist; run it before final `05` verification if x.ai/OpenAI should be
the default stack. `05` validates the selected stack end to end. `07` can land after `06`
(or alongside adapter work) to surface partial provider configuration without gating boot.

## The complete Convex function surface (boot-critical)

If any of these is missing, the app flips to `isMisconfigured` / no-credits and **gates AI
off entirely** (`aiAllowed = isSignedIn && !isMisconfigured`).

| Function | Type | Args | Returns | Swift source |
|---|---|---|---|---|
| `models:list` | query (sub) | — | `CatalogEntry[]` | ModelCatalog.swift:54 |
| `uploads:generateUploadTicket` | mutation | — | `{ uploadUrl }` | GenerationBackend.swift:30 |
| `uploads:commitUpload` | action | `storageId` | `{ url }` | GenerationBackend.swift:49 |
| `generations:submit` | mutation | `model, params, projectId?` | `{ jobId }` | GenerationBackend.swift:69 |
| `generations:byId` | query (sub) | `id` | `BackendGenerationJob \| null` | GenerationBackend.swift:13 |
| `users:upsertFromAuth` | mutation | `email, name, image` | — | AccountService.swift:225 |
| `account:get` | query (sub) | — | `{ user, plan? }` | AccountService.swift:273 |
| `billing:listPlans` | query (sub) | — | `AvailablePlan[]` | AccountService.swift:251 |
| `billing:createCheckoutSession` | action | `tier` | `{ url }` | AccountService.swift:349 |
| `billing:createTopOffCheckoutSession` | action | `dollars` | `{ url }` | AccountService.swift:374 |
| `billing:createPortalSession` | action | — | `{ url }` | AccountService.swift:415 |
| `feedback:send` | action | `message, mayContact, appVersion, osVersion, email?, screenshotPngBase64?` | `{ ok }` | AccountService.swift:408 |

See `00-foundation.md` for the exact decode/encode shapes each return type must match.
