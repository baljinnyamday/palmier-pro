# PalmierPro

AI-native macOS video editor. Swift 6.2, SwiftUI + AppKit, AVFoundation. macOS 26 only, arm64 only. Non-sandboxed Developer ID app.

## Build

```bash
swift build
swift run
```

## Code style

- Keep comments minimal. Only write one when the *why* is non-obvious. Don't restate what the code does, don't narrate the current change, don't leave `// removed X` breadcrumbs. One short line max — no multi-line comment blocks or paragraph docstrings.

## Design System

All UI styling MUST use `AppTheme` constants from `Sources/PalmierPro/UI/AppTheme.swift`. Never use hardcoded numeric values for:

- **Spacing/padding** → `AppTheme.Spacing.*` (xxs through xxl)
- **Font sizes** → `AppTheme.FontSize.*` (xxs through display)
- **Font weights** → `AppTheme.FontWeight.*` (regular, medium, semibold, bold)
- **Corner radii** → `AppTheme.Radius.*` (xs through xl)
- **Border widths** → `AppTheme.BorderWidth.*` (hairline, thin, medium, thick)
- **Opacity** → `AppTheme.Opacity.*` (subtle, faint, muted, medium, strong, prominent)
- **Icon frame sizes** → `AppTheme.IconSize.*` (xs through xl)
- **Shadows** → `AppTheme.Shadow.*` (sm, md, lg) via `.shadow(AppTheme.Shadow.md)`
- **Colors** → `AppTheme.Text.*`, `AppTheme.Border.*`, `AppTheme.Background.*`
- **Animation durations** → `AppTheme.Anim.*`

If a needed value doesn't exist in AppTheme, add it there first — don't hardcode it.

## Drag and drop

SwiftUI `.onDrop` on a parent view shadows every drop target inside its layout area on macOS 26 — even AppKit `NSDraggingDestination` children registered directly with the window. Inner `.onDrop` modifiers silently never fire while a parent `.onDrop` is active.

Rule: **any drop target that spans an area containing other drop targets must use native AppKit** (see `MediaPanelDropArea` in `Sources/PalmierPro/MediaPanel/`). Inner / leaf drops can stay SwiftUI `.onDrop`. Do not stack SwiftUI `.onDrop` modifiers in parent/child layouts.

## Voice

Palmier Pro speaks like a quietly capable native Mac app for filmmakers: direct, technical, calm, and 
confident. Prefer Apple HIG-style terseness over warmth. Never chatty or cute. Never marketing. When the
product needs to ask for action, lead with the action verb; when it reports state, name the thing.

## Learned User Preferences

- Prefer `swift build && swift run` for day-to-day UI and Swift changes instead of `./scripts/dev.sh`.
- Local development without Palmier `.env` keys or Developer ID signing certificate is expected.
- Prefer Multitask Mode in one session over separate chat windows for dependent parallel work (e.g. plans 00 → 01–04 → 05 wave pattern).
- For multi-part implementation, spawn subagents on auto; reserve gpt-5.5-high for review passes only.

## Learned Workspace Facts

- Metal shader compilation requires Xcode's Metal Toolchain (`xcodebuild -downloadComponent MetalToolchain`); Command Line Tools alone are insufficient.
- `./scripts/dev.sh` defaults to Palmier's Developer ID signing; without that cert, use `SIGNING_IDENTITY='-' ./scripts/dev.sh` or ad-hoc sign `.build/PalmierPro.app`.
- Missing root `.env` (Clerk/Convex keys) does not block the editor; only account and generative features are disabled.
- In-app agent chat and the MCP server share one `ToolExecutor` with 39 tools; chat calls tools directly via Anthropic tool-use, not through the local MCP server.
- A single local MCP server runs at `http://127.0.0.1:19789/mcp` while Palmier Pro is open.
- Generative video/image/audio routes through Palmier's Convex backend (closed source); `GenerationBackend.swift` is the primary client integration point to swap or fork.
- Self-hosted generation backend lives in `backend/convex/`; rollout plans are in `docs/plans/` (00 foundation serial, 01–04 adapters parallel, 06 provider pivot optional, 05 app wiring serial). Default providers: x.ai (image/video/TTS), OpenAI (image fallback). fal/ElevenLabs models are opt-in only (`FAL_KEY`/`ELEVENLABS_API_KEY` optional); no silent fallback to Seedance or fal.
- Only `generate_video`, `generate_image`, `generate_audio`, and `upscale_media` require sign-in and credits; all other agent/MCP tools run locally without a Palmier subscription.

