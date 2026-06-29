# 00 — Foundation: Convex project, schema, auth, job lifecycle, boot functions

**Implement this first.** It defines the shared schema, `providers/types.ts`, and the
`routeToProvider` signature that all adapter plans (`01`–`04`) depend on. When done, the
backend must compile, boot, authenticate a Clerk user, and run a generation job end to end
**with stub adapters** (each kind throws "not implemented" but the lifecycle works).

## Context (why)

The macOS app talks to a Convex deployment via the ConvexMobile SDK. We self-host an
equivalent deployment so the four paid generation features work against our own provider
keys. This plan builds everything except the provider adapter bodies.

## Convex conventions (follow these — verified against docs.convex.dev/understanding/best-practices)

- **New function syntax with both validators.** Every function declares `args` **and**
  `returns` validators: `query/mutation/action({ args: {...}, returns: v.<...>, handler })`.
- **Public vs internal.** Only functions the macOS client calls are public
  (`query/mutation/action`). Everything else is `internalQuery/internalMutation/internalAction`.
- **The provider worker is an `internalAction`** (it calls external HTTP APIs). Actions
  **cannot** touch the db — they persist via `ctx.runMutation(internal.generations.setX, …)`.
- **Mutation schedules the action**, never the client. `submit` (mutation) inserts the row
  then `ctx.scheduler.runAfter(0, internal.generations.process, { jobId })`.
- **Query with indexes, not `.filter()`** — use `.withIndex("by_clerk", q => q.eq(...))`.
- **No `v.any()` for `params`** — use the `generationParams` discriminated union (below).
- **Put shared logic in `convex/model/*`** plain helpers; wrap them in thin internal
  functions to avoid sequential `ctx.runQuery`/`ctx.runMutation` round-trips in actions.

## Project setup

Create `backend/` at repo root:

```
backend/
  package.json
  .env.example
  convex/
    auth.config.ts
    schema.ts
    account.ts
    uploads.ts
    models.ts
    generations.ts
    billing.ts
    feedback.ts
    providers/
      types.ts
      router.ts
```

`package.json`: a `convex` dependency and `"dev": "convex dev"`, `"deploy": "convex deploy"`.
Use the self-hosted Convex backend or a Convex cloud dev deployment. Node 18+.

`.env.example` documents required env vars:
- `CLERK_JWT_ISSUER_DOMAIN` — Clerk Frontend API URL (e.g. `https://xxx.clerk.accounts.dev`)
- Provider keys (filled in by adapter plans): `FAL_KEY`, `ELEVENLABS_API_KEY`, etc.

## Auth — `convex/auth.config.ts`

The client authenticates with a Clerk JWT (template named `convex`). Trust it:

```ts
export default {
  providers: [
    { domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" },
  ],
};
```

In Clerk: create a JWT template named `convex`. In functions, read the user via
`await ctx.auth.getUserIdentity()` — `identity.subject` is the Clerk user id.

## Schema — `convex/schema.ts`

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const tier = v.union(v.literal("none"), v.literal("pro"), v.literal("max"));

// Discriminated union — reuse this as the `submit` args validator too (no v.any()).
export const generationParams = v.union(
  v.object({
    kind: v.literal("image"), prompt: v.string(), aspectRatio: v.string(),
    resolution: v.optional(v.string()), quality: v.optional(v.string()),
    imageURLs: v.optional(v.array(v.string())), numImages: v.number(),
  }),
  v.object({
    kind: v.literal("video"), prompt: v.string(), duration: v.number(),
    aspectRatio: v.string(), resolution: v.optional(v.string()),
    sourceVideoURL: v.optional(v.string()), startFrameURL: v.optional(v.string()),
    endFrameURL: v.optional(v.string()), referenceImageURLs: v.optional(v.array(v.string())),
    referenceVideoURLs: v.optional(v.array(v.string())),
    referenceAudioURLs: v.optional(v.array(v.string())), generateAudio: v.boolean(),
  }),
  v.object({
    kind: v.literal("audio"), prompt: v.string(), voice: v.optional(v.string()),
    lyrics: v.optional(v.string()), styleInstructions: v.optional(v.string()),
    instrumental: v.boolean(), durationSeconds: v.optional(v.number()),
    videoURL: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("upscale"), sourceURL: v.string(), durationSeconds: v.number(),
  }),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    tier,
    spentCreditsThisPeriod: v.number(),
    purchasedCredits: v.number(),
  }).index("by_clerk", ["clerkId"]),

  generations: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("video"), v.literal("image"),
      v.literal("audio"), v.literal("upscale"),
    ),
    model: v.string(),
    params: generationParams,        // discriminated union — never v.any()
    projectId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"), v.literal("running"),
      v.literal("succeeded"), v.literal("failed"),
    ),
    resultUrls: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
    costCredits: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),
});
```

## Exact wire contracts (must match the Swift decoders byte-for-byte on keys)

### Incoming `params` (self-tagging — dispatch on `params.kind`)
Each struct encodes its own `kind` and **omits empty URL arrays and nil scalars**. Treat
absent arrays as `[]`. Keys (from
`Sources/PalmierPro/Generation/Catalog/*ModelConfig.swift`):

- `video`: `kind:"video", prompt, duration, aspectRatio, resolution?, sourceVideoURL?, startFrameURL?, endFrameURL?, referenceImageURLs?, referenceVideoURLs?, referenceAudioURLs?, generateAudio`
- `image`: `kind:"image", prompt, aspectRatio, resolution?, quality?, imageURLs?, numImages`
- `audio`: `kind:"audio", prompt, voice?, lyrics?, styleInstructions?, instrumental, durationSeconds?, videoURL?`
- `upscale`: `kind:"upscale", sourceURL, durationSeconds`

### Outgoing job — `generations:byId` returns this (or `null`)
Swift `BackendGenerationJob` (`GenerationBackend.swift:116`):
`{ _id, status: queued|running|succeeded|failed, resultUrls?: string[], errorMessage?, costCredits?, completedAt? }`.
A raw Convex `generations` document already satisfies this — Swift `Decodable` ignores extra
keys. Just return `ctx.db.get(id)`.

### `account:get` returns `{ user, plan? }`
Swift `AccountResponse` (`AccountService.swift:73`):
```
user: { email?, name?, image?, tier: "none"|"pro"|"max",
        currentPeriodEnd?, cancelAtPeriodEnd?,
        spentCreditsThisPeriod?, purchasedCredits? }
plan?: { tier, monthlyPriceUsd, monthlyBudgetCredits? }
```
The credit gate is `budgetCredits = (plan.monthlyBudgetCredits ?? 0) + purchasedCredits`,
spent = `spentCreditsThisPeriod`. **For personal use, return tier `"max"` with a large
`monthlyBudgetCredits` (e.g. 1_000_000) and `spentCreditsThisPeriod: 0` so AI is never
gated.** Keep the real values in the `users` row for the multi-user future.

## `providers/types.ts`

```ts
export type ImageParams = {
  kind: "image"; prompt: string; aspectRatio: string;
  resolution?: string; quality?: string; imageURLs?: string[]; numImages: number;
};
export type VideoParams = {
  kind: "video"; prompt: string; duration: number; aspectRatio: string;
  resolution?: string; sourceVideoURL?: string; startFrameURL?: string; endFrameURL?: string;
  referenceImageURLs?: string[]; referenceVideoURLs?: string[]; referenceAudioURLs?: string[];
  generateAudio: boolean;
};
export type AudioParams = {
  kind: "audio"; prompt: string; voice?: string; lyrics?: string; styleInstructions?: string;
  instrumental: boolean; durationSeconds?: number; videoURL?: string;
};
export type UpscaleParams = {
  kind: "upscale"; sourceURL: string; durationSeconds: number;
};
export type GenerationParams = ImageParams | VideoParams | AudioParams | UpscaleParams;

export type ProviderResult = { resultUrls: string[]; costCredits: number };
```

## `providers/router.ts` (skeleton — adapters land in 01–04)

```ts
import { GenerationParams, ProviderResult } from "./types";

export async function routeToProvider(
  model: string, params: GenerationParams,
): Promise<ProviderResult> {
  switch (params.kind) {
    case "image":   return imageAdapter(model, params);
    case "video":   return videoAdapter(model, params);
    case "audio":   return audioAdapter(model, params);
    case "upscale": return upscaleAdapter(model, params);
  }
}

// Replaced by 01–04. Until then each throws so the lifecycle is testable.
async function imageAdapter(_m: string, _p: any): Promise<ProviderResult> {
  throw new Error("image adapter not implemented");
}
async function videoAdapter(_m: string, _p: any): Promise<ProviderResult> {
  throw new Error("video adapter not implemented");
}
async function audioAdapter(_m: string, _p: any): Promise<ProviderResult> {
  throw new Error("audio adapter not implemented");
}
async function upscaleAdapter(_m: string, _p: any): Promise<ProviderResult> {
  throw new Error("upscale adapter not implemented");
}
```

## `uploads.ts` (3-step upload the client drives)

```ts
import { mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const generateUploadTicket = mutation({
  args: {},
  handler: async (ctx) => ({ uploadUrl: await ctx.storage.generateUploadUrl() }),
});

export const commitUpload = action({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
    if (!url) throw new Error("Upload not found");
    return { url };
  },
});
```
The client POSTs file bytes to `uploadUrl`; Convex natively returns `{ storageId }` (matches
the Swift `StagingUploadResponse`). Then `commitUpload` resolves a public URL.

## `generations.ts` (job lifecycle)

- `submit` **mutation** — args `{ model: v.string(), params: generationParams, projectId: v.optional(v.string()) }`, returns `v.object({ jobId: v.string() })`:
  1. `const identity = await ctx.auth.getUserIdentity()`; throw if null.
  2. Look up the `users` row by `clerkId`.
  3. (multi-user seam) check remaining credits; for now skip/allow.
  4. Insert a `generations` doc: `status:"queued"`, `kind: params.kind`, `model`, `params`,
     `projectId`, `userId`.
  5. `await ctx.scheduler.runAfter(0, internal.generations.process, { jobId })`.
  6. `return { jobId }` (the inserted `_id`, serialized as string).
- `byId` **query** — args `{ id: v.string() }`: `return await ctx.db.get(id as Id<"generations">)`.
  (Multi-user: assert the doc's `userId` matches the caller.)
- `process` **`internalAction`** — args `{ jobId }` (calls external provider APIs):
  1. Patch the job `status:"running"` (via an internal mutation).
  2. `const { resultUrls, costCredits } = await routeToProvider(job.model, job.params)`.
  3. On success: patch `{ status:"succeeded", resultUrls, costCredits, completedAt: Date.now() }`
     and (seam) increment `spentCreditsThisPeriod`.
  4. On throw: patch `{ status:"failed", errorMessage: String(err) }`.

Provide thin internal mutations `setRunning`, `setSucceeded`, `setFailed` (actions can't
touch the db directly).

## `models.ts` — `models:list` query (static catalog)

Return a `CatalogEntry[]`. This is the **heaviest contract** and fails *silently* if a field
is wrong (UI renders no controls, defaults don't resolve). Shape from
`Sources/PalmierPro/Generation/Catalog/ModelCatalog.swift:112-240`:

```
CatalogEntry = {
  id, kind: "video"|"image"|"audio"|"upscale", displayName,
  allowedEndpoints: string[],
  responseShape: "video"|"images"|"audio"|"upscaledImage",
  uiCapabilities: <Caps for the kind>,        // shape depends on kind, see below
  creditsPerSecond?: Record<string, number>,  // keyed by resolution
  audioDiscountRate?: Record<string, number>,
  creditsPerImage?: Record<string, number>,
  qualities?: string[],
  audioPricing?: { mode: "perThousandChars"|"perSecond"|"flat", rate?, price? },
  creditsPerSecondUpscale?: number,
}
```
Caps shapes (all keys required unless `?`):
- **VideoCaps**: `durations:int[], resolutions?:string[], aspectRatios:string[], supportsFirstFrame:bool, supportsLastFrame:bool, maxReferenceImages:int, maxReferenceVideos:int, maxReferenceAudios:int, maxTotalReferences?:int, maxCombinedVideoRefSeconds?:number, maxCombinedAudioRefSeconds?:number, framesAndReferencesExclusive:bool, referenceTagNoun:string, requiresSourceVideo:bool, requiresReferenceImage:bool`
- **ImageCaps**: `resolutions?:string[], aspectRatios:string[], qualities?:string[], supportsImageReference:bool, maxImages:int`
- **AudioCaps**: `category:"tts"|"music"|"sfx", voices?:string[], defaultVoice?:string, supportsLyrics:bool, supportsInstrumental:bool, supportsStyleInstructions:bool, durations?:int[], minPromptLength:int, inputs?:string[], promptLabel?:string, minSeconds?:int, maxSeconds?:int`
- **UpscaleCaps**: `speed:"Fast"|"Medium"|"Slow", p75DurationSeconds:int, supportedTypes:string[]` (`"video"|"image"`)

Seed **one working entry per kind** matching the model ids the adapter plans choose (e.g.
`nano-banana-pro` image, `seedance-2.0-fast` video, `elevenlabs-tts-v3` audio,
`seedvr-image-upscaler` upscale). The adapter plans specify their ids.

## `billing.ts` + `account.ts` + `feedback.ts` (boot plumbing, mostly stubs)

- `account.ts`:
  - `users:upsertFromAuth` mutation — args `{ email?, name?, image? }`: upsert the `users`
    row keyed by `identity.subject`; default `tier:"max"`, `spentCreditsThisPeriod:0`,
    `purchasedCredits:0` for personal use.
  - `account:get` query — return `{ user, plan }` per the shape above (large budget).
- `billing.ts`:
  - `listPlans` query — return a small static `AvailablePlan[]`
    (`{ tier, monthlyPriceUsd, discountedMonthlyPriceUsd?, monthlyBudgetCredits? }`).
  - `createCheckoutSession` / `createTopOffCheckoutSession` / `createPortalSession` actions
    — throw `new Error("Billing not enabled")` (buttons exist in UI but aren't the goal).
- `feedback.ts`: `send` action — log args, `return { ok: true }`.

## Acceptance criteria

1. `convex dev` deploys with no schema/type errors.
2. App configured against the deployment signs in via Clerk and is **not** `isMisconfigured`;
   `account:get` loads with a non-zero budget.
3. `models:list` populates the model pickers (one model per kind visible).
4. Triggering any generation creates a `generations` doc that transitions
   `queued → running → failed` with `errorMessage` "… adapter not implemented" — proving the
   whole submit → schedule → process → `byId` subscription path works before any provider is
   wired.
