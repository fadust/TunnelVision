# Canon evidence fork

This branch runs `canon-main.js` with the **full upstream TunnelVision interface**. It starts `index.js` under enforced canon ownership, retaining the tree editor/builders, search modes, selective retrieval, provider/embedding profiles, tool prompts, confirmations, diagnostics, language controls and import/export. Canon source/review controls live inside the full panel. Only memory writers overlapping BaiBai/Codex are disabled. BaiBai remains completed-event memory; NPC Codex remains accepted actor state.

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

Source analysis uses application-numbered passages. The model returns references; the application restores exact source text before the unchanged compiler checks compatibility, chronology and identity evidence. Malformed JSON, unknown references or incomplete evidence receive one bounded correction attempt; a second failure stays unavailable. Version 2 cache keys prevent reuse of the earlier quotation-copying analysis. No permissive JSON repair, raw-lore fallback or new actor/memory writer is introduced.

Turn Queue can await `TunnelVision.bridge.ensureReady()` before prompt assembly. Whole-book analysis allows one configured timeout per source batch plus an indexing allowance; each provider call remains bounded and chat/source changes still cancel stale work. The old two-minute whole-book deadline could cancel a valid first batch before later batches completed.

Run `npm run test:canon` with the companion NPC Codex checkout at `../npc_codex` for the cross-repository admission/lock/death fixture. The port and runtime suites run independently with Node 24. Run `npm test` for upstream/interface tests. Synthetic provider tests verify the integration contract, not real-provider relevance or latency.

## Full interface restoration — 23 October

Canon source analysis honours the configured sidecar response limit. It previously capped each analysis response at 8,192 tokens even with a larger saved profile, truncating MiniMax M3 output for a real 27-entry book. The scanner fallback retains its 8,192-token limit; source validation, truncation rejection and NPC admission guards are unchanged. The Canon integration workflow runs the canon suites and 73 focused interface/provider checks against the pinned companion Codex revision.

This supersedes the original restricted-UI design. Saved settings/data are retained; the runtime reads overlapping writer flags as false without resetting the saved values. Writer event processors and cleanup/hydration are not started. Disabled controls remain visible with an ownership explanation.

| Retained | Canon-compatible behavior |
|---|---|
| Tree editor, metadata/LLM builders, node summaries, import/export | Original manual management UI; tree structure is projected over eligible evidence. Raw generated summaries/previews never become story evidence. |
| Traversal/collapsed search, depth, unified/separate books, selective retrieval | Search uses validated evidence IDs. Ambiguous cross-book numeric UIDs are rejected; no raw-content fallback. |
| Reorganize, Merge/Split; explicit merge/split/dedupe commands | Existing manual management paths, permissions and confirmations retained. Reorganize's list view uses guarded evidence. Source changes invalidate dependent canon analysis normally. |
| Sidecar/embedding profiles, language, output caps, background timeout | Enabled profiles are honored; otherwise existing NPC scanner/canon embeddings remain the defaults. Truncated responses fail; cancellation reaches requests. Scanner settings are not rewritten. |
| Auto Retrieval | Controls the scene selector; exact/vector evidence and explicit Search remain available when disabled. The user tree is filtered before selection. The 96,000-character ceiling remains. |
| Smart Context | Shares the canon delivery gate, using its placement/entry/character limits. No second raw injector. |
| Narrative conditions | Evaluated on filtered evidence in the existing selector. Unmet/unknown conditions stay withheld even from exact lookup. Enabled conditions can still require evaluation when Auto Retrieval is off. |
| Native injection mode | Retains native placement for eligible filtered passages; no duplicate canon-slot delivery. Multi-source evidence still requires all source gates. |
| Canon review and NPC bridge | Source/version, revision, ambiguity/no-match/unavailable, context, provenance, manual locks, knowledge and death contracts retained. |

Disabled: Remember, Update, Forget, Summarize, Notebook, chat ingest, automatic summaries, post-generation/post-turn extraction, rolling world/actor state and automatic memory lifecycle. Commands for these writers explain ownership rather than writing. Existing saved memory is not deleted.

Search results share the generation's 1,000-token whole-passage delivery ledger, including automatic/native delivery. Repeated tool calls do not create a fresh canon budget. User lower token/character caps apply. The upstream recurse/tool-display controls remain available.

The focused interface suite loads the actual upstream entry and panel, checks writer non-activation with legacy flags enabled, and exercises guarded traversal/collapsed/selective search. Canon runtime checks include native placement timing, conditional filters, shared tool budgets and stale IDs.

Known baseline: unchanged upstream `entry-manager.test.js` has 28 failures (25 passing), reproduced at deployed `63d630b`; no unrelated fixes or silent skips. The upstream lockfile omits optional packages for other platforms, so current npm rejects `npm ci`. Install the existing development dependencies with `npm install --ignore-scripts --package-lock=false` without rewriting the lockfile.

Rollback: restore the recorded Saga/Codex pre-deployment commits and move this newly installed extension outside the live third-party folder; reload. Retain the new metadata for recovery. Do not reset user settings, chats or authoring files.
