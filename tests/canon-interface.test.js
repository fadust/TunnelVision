/* @vitest-environment jsdom */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import $ from 'jquery';

const runtime = vi.hoisted(() => ({ events: new Map(), commands: new Map(), tools: [], view: null, settings: { tunnelvision: {} } }));
vi.mock('../../../extensions.js', () => ({
    extension_settings: runtime.settings,
    renderExtensionTemplateAsync: async () => (await import('node:fs/promises')).readFile(`${process.cwd()}/settings.html`, 'utf8'),
}));
vi.mock('../../../../script.js', () => ({
    saveSettingsDebounced: vi.fn(), saveChatConditional: vi.fn(), main_api: 'openai', online_status: 'connected',
    characters: [], this_chid: 0, chat_metadata: {}, generateRaw: vi.fn(), chat: [],
    event_types: Object.fromEntries(['CHAT_CHANGED', 'APP_READY', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED', 'GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED', 'WORLDINFO_ENTRIES_LOADED'].map(n => [n, n])),
    eventSource: { on: (name, fn) => runtime.events.set(name, fn), once: vi.fn(), makeLast: vi.fn() },
    extension_prompt_types: { IN_CHAT: 1, IN_PROMPT: 0 }, extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 }, setExtensionPrompt: vi.fn(),
}));
vi.mock('../../../st-context.js', () => ({ getContext: () => ({
    chatId: 'test', chat: [{ mes: 'Hello', is_user: true }], chatMetadata: {}, characterId: 0, characters: [{ avatar: 'ari.png' }],
    extensionSettings: runtime.settings, registerSlashCommand: (name, callback) => runtime.commands.set(name, callback),
}) }));
vi.mock('../../../world-info.js', () => ({ world_names: ['Book'], selected_world_info: [], world_info: {}, METADATA_KEY: 'world_info', loadWorldInfo: vi.fn(async () => ({ entries: {} })), saveWorldInfo: vi.fn(), createWorldInfoEntry: vi.fn(), deleteWorldInfoEntry: vi.fn(), deleteWIOriginalDataValue: vi.fn() }));
vi.mock('../../../tool-calling.js', () => ({ ToolManager: class {
    static tools = runtime.tools;
    static registerFunctionTool(def) { runtime.tools.push({ ...def, toFunctionOpenAI: () => ({ function: { name: def.name } }) }); }
    static unregisterFunctionTool(name) { const index = runtime.tools.findIndex(t => t.name === name); if (index >= 0) runtime.tools.splice(index, 1); }
} }));
vi.mock('../canon/context/semantic-canon.js', () => ({
    selectedCanonBooks: () => ['Book'], canonToolPreview: () => runtime.view || { revision: '', evidence: [] },
    canonToolView: async () => runtime.view, retrieveCanonTool: vi.fn(async (_revision, ids) => JSON.stringify(ids)),
}));
vi.mock('../auto-summary.js', () => ({ initAutoSummary: vi.fn(), getAutoSummaryCount: () => 0, resetAutoSummaryCount: vi.fn(), markAutoSummaryComplete: vi.fn() }));
vi.mock('../summary-collapse.js', () => ({ initSummaryCollapse: vi.fn() }));
vi.mock('../post-turn-processor.js', () => ({ initPostTurnProcessor: vi.fn() }));
vi.mock('../world-state.js', () => ({ initWorldState: vi.fn(), getWorldStateSections: () => ({}) }));
vi.mock('../smart-context.js', () => ({ initSmartContext: vi.fn() }));
vi.mock('../memory-lifecycle.js', () => ({ initMemoryLifecycle: vi.fn() }));
vi.mock('../activity-feed.js', () => ({ initActivityFeed: vi.fn(), refreshHiddenToolCallMessages: vi.fn(), logToolCallStarted: vi.fn() }));

import { enableCanonOwnership, ownershipSettings, MEMORY_TOOLS } from '../canon/ownership.js';
import { getSettings } from '../tree-store.js';
import { getCanonSearchDefinition, filteredTree } from '../canon/search.js';
import { retrieveCanonTool } from '../canon/context/semantic-canon.js';
import { initAutoSummary } from '../auto-summary.js';
import { initPostTurnProcessor } from '../post-turn-processor.js';
import { initWorldState } from '../world-state.js';
import { initSmartContext } from '../smart-context.js';
import { initMemoryLifecycle } from '../memory-lifecycle.js';

beforeAll(async () => {
    vi.useFakeTimers(); vi.stubGlobal('$', $); vi.stubGlobal('toastr', { info: vi.fn(), warning: vi.fn(), error: vi.fn() });
    runtime.settings.tunnelvision = { canon: { layer1Sources: { 'ari.png': ['Book'] } }, notebookEnabled: true, autoSummaryEnabled: true, worldStateEnabled: true, postTurnEnabled: true, lifecycleEnabled: true, sidecarPostGenWriter: true };
    enableCanonOwnership();
    document.body.innerHTML = '<div id="extensions_settings2"></div>';
    await import('../index.js');
});
afterAll(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('full interface with canon ownership', () => {
    it('mounts the original interface and disables only competing writers', () => {
        expect(document.getElementById('tunnelvision_settings')).toBeTruthy();
        for (const id of ['tv_build_metadata', 'tv_build_llm', 'tv_open_tree_editor', 'tv_bulk_export', 'tv_bulk_import', 'tv_run_diagnostics', 'tv_sidecar_test', 'tv_smart_context_enabled']) expect(document.getElementById(id)?.disabled).toBe(false);
        for (const tool of document.querySelectorAll('.tv_tool_enabled')) expect(tool.disabled).toBe(MEMORY_TOOLS.has(tool.dataset.tool));
        expect(document.getElementById('tv_ingest_chat').disabled).toBe(true);
        expect(document.querySelectorAll('input[name="tv_search_mode"]').length).toBe(2);
    });
    it('does not start writers even with legacy settings enabled', () => {
        for (const init of [initAutoSummary, initPostTurnProcessor, initWorldState, initSmartContext, initMemoryLifecycle]) expect(init).not.toHaveBeenCalled();
        expect(runtime.events.has('MESSAGE_RECEIVED')).toBe(false);
        expect(runtime.events.has('MESSAGE_DELETED')).toBe(false);
        expect(getSettings().notebookEnabled).toBe(false);
        expect(runtime.settings.tunnelvision.notebookEnabled).toBe(true);
        ownershipSettings(runtime.settings.tunnelvision).postTurnEnabled = true;
        expect(getSettings().postTurnEnabled).toBe(false);
    });
    it('keeps search and organization tools but excludes memory tools and slash-command writes', async () => {
        const names = runtime.tools.map(t => t.name);
        expect(names).toEqual(expect.arrayContaining(['TunnelVision_Search', 'TunnelVision_Reorganize', 'TunnelVision_MergeSplit']));
        expect(names.some(name => MEMORY_TOOLS.has(name))).toBe(false);
        await runtime.commands.get('tv-remember')({}, 'invent a memory');
        expect(toastr.info).toHaveBeenCalledWith(expect.stringContaining('BaiBai'), 'TunnelVision');
        const guide = runtime.tools.find(t => t.name === 'TunnelVision_Guide');
        expect(await guide.action({ tool: 'TunnelVision_Remember' })).not.toContain('Full instructions');
    });
    it('keeps user tree organization and discards raw summaries and excluded entries', () => {
        const evidence = [{ id: 'safe', title: 'Ari', world: 'Book', uid: 7, basis: [{ source: 'book:Book:7' }] }];
        const tree = filteredTree(evidence, ['Book'], { trees: { Book: { root: { id: 'root', label: 'Root', summary: 'RAW SECRET', entryUids: [7, 8], children: [{ id: 'bad', label: 'Excluded fire version', entryUids: [8] }] } } } });
        expect(JSON.stringify(tree)).not.toMatch(/RAW SECRET|Excluded fire/);
        expect(tree[0].entries.map(e => e.id)).toEqual(['safe']);
    });
    it('supports traversal, collapsed and selective retrieval with qualified evidence IDs', async () => {
        runtime.view = { revision: 'current', evidence: [{ id: 'safe', title: 'Ari', entityType: 'character', world: 'Book', uid: 7, text: 'Validated storm magic', basis: [{ source: 'book:Book:7' }] }] };
        const search = getCanonSearchDefinition();
        const menu = JSON.parse(await search.action({ action: 'navigate' }));
        expect(menu.tree[0].id).toBe('canon:character');
        expect(await search.action({ node_id: 'canon:character', action: 'retrieve' })).toContain('evidence_id');
        await search.action({ evidence_ids: ['safe'], action: 'retrieve' });
        expect(retrieveCanonTool).toHaveBeenLastCalledWith('current', ['safe']);
        expect(await search.action({ evidence_ids: ['stale'] })).toContain('stale');
        getSettings().searchMode = 'collapsed'; getSettings().selectiveRetrieval = false;
        await search.action({ node_ids: ['canon:character'] });
        expect(retrieveCanonTool).toHaveBeenLastCalledWith('current', ['safe']);
        runtime.view.evidence.push({ ...runtime.view.evidence[0], id: 'other-book', world: 'Other', basis: [{ source: 'book:Other:7' }] });
        expect(await search.action({ entry_uids: [7] })).toContain('ambiguous');
    });
});
