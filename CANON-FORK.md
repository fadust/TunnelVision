# Canon evidence fork

This branch runs `canon-main.js`, a restricted canon runtime. It does **not** load upstream `index.js`, raw lore tools, slash-command writers, notebook, summaries, world simulation, post-turn extraction, or memory lifecycle. Existing TunnelVision settings are retained but those writers cannot run through this entry point. BaiBai remains completed-event memory; NPC Codex remains accepted actor state.

Upstream baseline: Coneja-Chibi/TunnelVision `cf84ad17ed0f9c9a57d0be5f219cba163706c876`. The compiler, storage, runtime checks and pure context/lifecycle helpers under `canon/` derive from fadust/Saga `34d44e73c79399abaa0bb52d062923687ad47065` (MentallyQuill; MIT notice in `canon/LICENSE-Saga`). Changes adapt ownership/storage/provider calls and add selection over a filtered, ephemeral collapsed evidence tree. This deliberately does not reuse upstream raw book summaries/previews, which would bypass version checks.

## Flow

1. Read the card and explicitly selected original native lorebooks. Existing Saga source/embedding/profile/placement settings are read as compatibility defaults, without rewriting them. Per-character book selection is available in the extension panel.
2. Analyze source-backed passages with the selected NPC Codex scanner profile; retain source/version checks, conditional age derivation, pending interpretations, ambiguity, revisions and invalidation. Reuse the existing BaiBaoKu `saga-layer1` cache and Similharity embeddings. This is a rebuildable canon index, not story memory.
3. Before a story generation, send the current validated evidence tree and recent pending chat to one selector request using the same profile. Selection can span actors, places, factions, objects and world constraints. Only current allowlisted evidence IDs are accepted. No generated fact text becomes evidence. The full selector input has a 96,000-character ceiling; it is never silently truncated.
4. Merge selected evidence with exact/alias retrieval, enforce whole-passage deduplication and the existing maximum 1,000 host-token budget, and pass book candidates through native activation. Only one canon prompt owner injects. Source selection may suppress native injection of managed books even when analysis fails, matching the conservative previous contract.
5. NPC Codex independently calls `TunnelVision.bridge.queryCanon`; identity queries remain bounded to three seconds and retain matched/no-match/ambiguous/unavailable statuses. No extra per-actor model calls. Existing `Saga:entity@revision` reference IDs remain stable for saved dossiers. Locks, knowledge, development and terminal death remain enforced by Codex.

The pre-generation selector can wait up to 120 seconds separately from the three-second Codex API. Stop, failure and chat switches clear prompts; cancelled/stale selection cannot commit. If the selector fails or exceeds its input ceiling, validated exact/vector retrieval remains available and the panel reports the selector unavailable. This fallback is **not proof of complete world-rule recall**. Elevate essential rules in the evidence panel; the token budget still applies.

## State and migration

Existing Saga chat decisions are copied into a separate `chatMetadata.tunnelvisionCanon` bucket on first use. Original Saga state, Saint Seiya authoring files and settings remain intact. The compatibility Saga update yields runtime ownership while this provider is enabled. Its authoring UI remains available. Disabling the provider yields back to Saga without resetting its settings.

On an existing chat, the updated Saga bridge can supply a snapshot of the context registry. Persisted snapshots allow the canon runtime to continue without Saga. If a required registry is unavailable, affected bounded interpretations stay withheld. New Saga authoring changes after handover are not automatically merged into the copied decisions: review them explicitly. The current panel reviews interpretations, selected source books, mute/elevate and analysis status; it is not the full Deck Maker UI.

## Verification

Run `npm run test:canon` with the companion NPC Codex checkout at `../npc_state_delta` for the cross-repository admission/lock/death fixture. The port and runtime suites run independently with Node 24 and need no new dependencies. Also run the companion Codex test suite and Saga handover runtime regression. Synthetic provider tests verify the integration contract, not real-provider relevance or latency. Verify those in an isolated browser test chat before declaring live story delivery successful.

Rollback: restore the recorded Saga/Codex pre-deployment commits and move this newly installed extension outside the live third-party folder; reload. Retain the new metadata for recovery. Do not reset user settings, chats or authoring files.
