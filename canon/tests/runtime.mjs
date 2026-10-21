import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./fixtures/layer1-ari.json', import.meta.url), 'utf8'));
const settings = { enabled: true, semanticCanonEnabled: true, layer1Sources: { 'ari.png': ['Original'] }, semanticCanonModel: 'embeddinggemma', semanticCanonApiUrl: 'local', semanticCanonTokenBudget: 1000 };
let state = { loreContext: {}, pendingLoreEntries: [], loreMatrix: [], loreSelection: {} };
let books = { Original: { entries: Object.fromEntries(fixture.sources.filter(s => s.kind === 'lorebook').map(s => [s.uid, { uid: s.uid, content: s.text, key: ['Ari'], disable: false }])) } };
const database = new Map(), vectors = new Map(), events = new Map(), prompts = new Map(), summaries = [];
let providerCalls = 0, embeddingCalls = 0, dbFailure = false, delayProvider = null, delaySearch = false;
const ctx = { characterId: 0, characters: [{ ...fixture.card, avatar: 'ari.png' }], getCurrentChatId: () => 'fixture',
    extensionSettings: { npc_state_delta: { scannerConnectionProfile: 'fixture-profile' } },
    getRequestHeaders: () => ({}), getTokenCountAsync: async text => Math.ceil(text.length / 4),
    setExtensionPrompt: (key, value) => prompts.set(key, value),
    eventTypes: Object.fromEntries(['CHAT_CHANGED', 'CHARACTER_EDITED', 'WORLDINFO_UPDATED', 'WORLDINFO_DELETED', 'WORLDINFO_ENTRIES_LOADED', 'WORLD_INFO_ACTIVATED', 'GENERATION_STOPPED', 'GENERATION_ENDED'].map(s => [s, s])),
    eventSource: { on: (name, fn) => events.set(name, fn) } };
const sandbox = vm.createContext({ console, structuredClone, crypto, TextEncoder, AbortController, AbortSignal, performance, btoa, setTimeout, clearTimeout,
    SillyTavern: { getContext: () => ctx }, CustomEvent: class { constructor(name, opts) { this.type = name; this.detail = opts.detail; } },
    document: { dispatchEvent: event => summaries.push(event.detail) },
    fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        if (dbFailure) throw new Error('Synthetic SQLite unavailable');
        if (url.includes('batch-embeddings')) {
            embeddingCalls++;
            if (delaySearch) await new Promise(resolve => setTimeout(resolve, 3100));
            return { ok: true, json: async () => ({ embeddings: body.texts.map(() => [1, 0, 0]) }) };
        }
        assert.equal(body.database, 'saga-layer1');
        const path = url.split('/v1/')[1];
        let data;
        if (path === 'get') data = { value: database.get(`${body.store}:${body.key}`) ?? null };
        else if (path === 'set') { database.set(`${body.store}:${body.key}`, structuredClone(body.value)); data = {}; }
        else if (path === 'vec/upsert') { vectors.set(body.scope, body.items); data = {}; }
        else if (path === 'vec/search') data = { results: [] };
        else throw new Error(`Unexpected storage route ${path}`);
        return { ok: true, json: async () => ({ ok: true, data }) };
    } });
const modules = new Map();
const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context: sandbox });
const stubs = {
    'state-manager.js': { getState: () => state, getSettings: () => settings, saveState: value => { state = value; } },
    'lore-llm-client.js': { sendLoreRequest: async (_system, prompt, options) => {
        options.onRequest?.(); assert.equal(options.profileId, 'fixture-profile');
        if (delayProvider) await delayProvider;
        const input = JSON.parse(prompt); if (input.tree) return JSON.stringify({ revision: input.revision, ids: [] }); providerCalls++; const analysis = structuredClone(fixture.analysis);
        const remap = id => id.replace('card:', 'card:ari.png:').replace('book:original:', 'book:Original:');
        analysis.facts = analysis.facts.map(f => ({ ...f, source: remap(f.source) })).filter(f => input.sources.some(s => s.id === f.source && s.text.includes(f.quote)));
        analysis.timeShift.source = remap(analysis.timeShift.source);
        analysis.proposals = analysis.proposals.map(p => ({ ...p, basis: p.basis.map(remap) }));
        return JSON.stringify(analysis);
    } },
    'lore-timeline.js': { recordLoreTimelineEvent: (_state, event) => summaries.push(event.patch.layer1Analysis) },
    'world-info.js': { loadWorldInfo: async name => structuredClone(books[name]) },
    'lore-injection-filter.js': { getInjectableLoreEntriesForInjection: state => state.loreMatrix.filter(e => !state.loreSelection.suppressedIds?.includes(e.id) && e.status !== 'archived'), getLoreEntryInjectionContextGate: entry => ({ eligible: !entry.testContextBlocked }) },
};
async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const name = url.pathname.split('/').pop();
    let module;
    if (stubs[name]) module = synthetic(stubs[name]);
    else module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context: sandbox, identifier: url.href,
        importModuleDynamically: async spec => { const m = await load(new URL(spec, url)); if (m.status === 'linked') await m.evaluate(); return m; } });
    modules.set(url.href, module);
    await module.link(spec => load(new URL(spec, url)));
    return module;
}
const module = await load(new URL('../context/semantic-canon.js', import.meta.url)); await module.evaluate();
const runtime = module.namespace;
await runtime.analyzeCanonSources();
assert.equal(state.layer1Analysis.status, 'ready');
assert.equal(state.layer1Analysis.proposalsCreated, 1);
assert.equal(state.pendingLoreEntries.length, 1);
const requests = providerCalls, embeddings = embeddingCalls;
await runtime.analyzeCanonSources({ force: true });
assert.equal(providerCalls, requests); assert.equal(embeddingCalls, embeddings);
assert.equal(state.pendingLoreEntries.length, 1); assert.equal(state.layer1Analysis.proposalsCreated, 0);
assert.equal((await runtime.querySemanticCanon('Ari', { purpose: 'identity' })).status, 'ambiguous');
assert.equal((await runtime.querySemanticCanon('Ari headmistress', { purpose: 'identity' })).candidates[0], 'Ari Senn');
assert.equal((await runtime.querySemanticCanon('Ari Vale', { purpose: 'identity' })).status, 'matched');
runtime.installCanonEvents();
await runtime.prepareSemanticCanon([{ is_user: true, mes: 'Ari Vale asks about family.' }], 'normal');
assert.ok(prompts.get('tunnelvision_lore_normal_relevance').includes('storm magic'));
assert.ok(!prompts.get('tunnelvision_lore_normal_relevance').includes('Mira Vale would'));
const groups = { globalLore: [{ world: 'Original', uid: 1, content: 'UNFILTERED ORIGINAL' }], characterLore: [], chatLore: [], personaLore: [] };
events.get('WORLDINFO_ENTRIES_LOADED')(groups);
assert.ok(groups.globalLore.every(e => e.position === 7 && e.outletName === '' && !e.content.includes('fire apprentice')));
events.get('WORLD_INFO_ACTIVATED')(groups.globalLore);
assert.ok(prompts.get('tunnelvision_lore_normal_relevance').includes('Mira Vale would be 44'));
assert.ok(!prompts.get('tunnelvision_lore_normal_relevance').includes('greater healing'));
assert.ok(ctx.getTokenCountAsync && Math.ceil([...prompts.values()].join('').length / 4) <= 1000);
// NPC scans outlive foreground generation and make quiet provider requests.
// Prompt cleanup must not claim that their source evidence changed.
const scanCanonToken = runtime.semanticCanonRevision();
events.get('GENERATION_ENDED')();
assert.equal(runtime.semanticCanonRevision(), scanCanonToken, 'Completion must preserve the canon token held by NPC scans');
await runtime.prepareSemanticCanon([], 'quiet');
assert.equal(runtime.semanticCanonRevision(), scanCanonToken, 'Quiet scanner requests must not invalidate canon');
events.get('GENERATION_STOPPED')(); assert.ok([...prompts.values()].every(text => !text));
assert.equal(runtime.semanticCanonRevision(), scanCanonToken, 'Cancellation clears prompts, not source evidence');
settings.loreNormalInjectionEnabled = false;
await runtime.prepareSemanticCanon([{ is_user: true, mes: 'Ari Vale enters.' }], 'normal');
assert.equal(runtime.semanticCanonStatus().selected.length, 0, 'Disabled tiers consume no generation budget');
settings.loreNormalInjectionEnabled = true;
await runtime.prepareSemanticCanon([{ is_user: true, mes: 'Ari Vale enters.' }], 'normal');
assert.ok(runtime.semanticCanonStatus().selected.length, 'Tier changes invalidate retrieval cache');
settings.enabled = false; assert.equal(runtime.semanticCanonStatus().enabled, false); settings.enabled = true;
runtime.invalidateCanon(); assert.notEqual(runtime.semanticCanonRevision(), scanCanonToken, 'Real source invalidation rejects NPC scan tokens'); runtime.syncCanonPrompts();
await runtime.analyzeCanonSources();

const accepted = structuredClone(state.pendingLoreEntries[0]);
state.loreMatrix.push(accepted);
await runtime.analyzeCanonSources({ force: true });
assert.equal(accepted.extensions.layer1.stale, false, 'Accepted basis remains valid without reacceptance');

// Rejected decisions survive analysis/cache reload; no duplicate proposal appears.
state.layer1Decisions = { [state.pendingLoreEntries[0].id]: { decision: 'rejected' } }; state.pendingLoreEntries = [];
runtime.invalidateCanon(); await runtime.analyzeCanonSources(); assert.equal(state.pendingLoreEntries.length, 0);
books.Original.entries[1].content += ' A new bridge crosses the river.';
runtime.invalidateCanon(); await runtime.analyzeCanonSources();
assert.equal(accepted.extensions.layer1.stale, false, 'Unrelated source changes preserve accepted interpretations');
assert.equal(providerCalls, requests + 1, 'Only the changed source batch calls the provider');
assert.equal(state.layer1Analysis.changedSources.length, 1);
ctx.characters[0].description += ' Additional current detail.';
runtime.invalidateCanon(); await runtime.analyzeCanonSources();
assert.equal(accepted.extensions.layer1.stale, true, 'Changed supporting sources flag accepted interpretations');
delete books.Original.entries[1]; runtime.invalidateCanon(); await runtime.analyzeCanonSources();
assert.ok(!runtime.semanticCanonStatus().evidence.some(e => /Mira Vale would/.test(e.text)));
assert.ok(state.layer1Analysis.changedSources.includes('book:Original:1'));

books.Original.entries.duplicate = { ...books.Original.entries[2] };
runtime.invalidateCanon(); await runtime.analyzeCanonSources(); assert.equal(state.layer1Analysis.status, 'failed');
assert.equal((await runtime.querySemanticCanon('Nobody', { purpose: 'identity' })).status, 'unavailable');
delete books.Original.entries.duplicate;
await runtime.analyzeCanonSources();
dbFailure = true; runtime.invalidateCanon(); await runtime.analyzeCanonSources(); assert.equal(state.layer1Analysis.status, 'failed');
dbFailure = false; await runtime.analyzeCanonSources();
delaySearch = true; const start = performance.now();
assert.equal((await runtime.querySemanticCanon('unrelated submarine', { purpose: 'identity' })).status, 'unavailable');
assert.ok(performance.now() - start < 3075, 'One three-second deadline bounds the complete retrieval loop');
delaySearch = false;
let release; delayProvider = new Promise(resolve => { release = resolve; });
ctx.characters[0].personality += ' New source revision.'; runtime.invalidateCanon();
const stale = runtime.analyzeCanonSources();
await new Promise(resolve => setTimeout(resolve, 15)); runtime.invalidateCanon(); release(); await stale;
assert.equal(runtime.semanticCanonStatus().evidence.length, 0, 'Superseded analysis cannot publish');
console.log(`Layer 1 runtime passed: SQLite cache, ${providerCalls} synthetic provider calls, ${embeddingCalls} embedding batches, review deduplication, native injection boundary, source edits/deletions, duplicate UIDs, failure, deadline and stale cancellation.`);
