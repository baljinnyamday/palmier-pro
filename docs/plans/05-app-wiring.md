# 05 — Wire the macOS app to the self-hosted backend + end-to-end verification

No Swift code changes — only configuration. Depends on `00-foundation.md` deployed and at
least one adapter (start with `01-adapter-image.md`).

## Configuration the app reads

`Sources/PalmierPro/Account/BackendConfig.swift` reads these from the app bundle's
Info dictionary:

| Info.plist key | Value |
|---|---|
| `PalmierConvexDeploymentURL` | your self-hosted Convex deployment URL |
| `PalmierClerkPublishableKey` | Clerk publishable key (same Clerk instance whose JWT issuer is in `auth.config.ts`) |
| `PalmierConvexHttpURL` | the deployment's HTTP actions URL (if used) |
| `PalmierClerkKeychainAccessGroup` | optional |

`isConfigured` requires both the Clerk key and the Convex URL. Without them the app sets
`isMisconfigured` and disables AI. Set these via the app target's build settings / Info.plist
(or an `.xcconfig`). The repo already expects local dev without Palmier's own keys (see
`AGENTS.md` "Learned User Preferences").

## Steps

1. Deploy `00` + the image adapter: `cd backend && npm i && npx convex dev`. Set
   `CLERK_JWT_ISSUER_DOMAIN` and the image provider key in the Convex env.
2. In Clerk, create the JWT template named `convex` and grab the publishable key + issuer
   domain.
3. Put `PalmierConvexDeploymentURL` + `PalmierClerkPublishableKey` into the app's Info.plist.
4. `swift build && swift run`.

## Verification (end to end)

1. **Boot:** app launches **not** `isMisconfigured`. Sign in via Clerk (Google). `account:get`
   loads with a non-zero credit budget. `models:list` populates the model pickers.
2. **Lifecycle (before providers):** with stub adapters, trigger any generation and confirm
   the placeholder asset goes `generating → … → failed` with the "not implemented" message —
   proves submit → schedule → `process` → `byId` subscription works.
3. **Image end to end:** run `generate_image` with a prompt. Watch the placeholder go
   `generating → downloading → none` and a real image import into the library. Re-run with a
   reference image (`referenceMediaRefs`) to confirm conditioning.
4. **Uploads:** confirm reference files reach the backend (3-step
   `generateUploadTicket → POST → commitUpload`) and the resulting HTTPS URLs are what the
   adapter receives in `params`.
5. Repeat per kind as `02`–`04` land: `generate_video`, `generate_audio` (TTS / music /
   video-to-audio), `upscale_media`.

## Done when

All four agent tools (`generate_video`, `generate_image`, `generate_audio`, `upscale_media`)
complete against the self-hosted backend with assets importing correctly, using our own
provider keys — no calls to Palmier's Convex deployment.
