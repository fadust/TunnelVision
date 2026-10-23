import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileCanon, retrieveCanon } from '../context/layer1-model.js';
import { evidenceTree, validateSelection } from '../context/tree-selection.js';
import { getSettings, getState, saveState } from '../state/state-manager.js';
import { sendLoreRequest } from '../providers/lore-llm-client.js';
import { getInjectableLoreEntriesForInjection } from '../lorecards/lore-injection-filter.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/layer1-ari.json', import.meta.url)));
const view = await compileCanon(fixture.sources, fixture.analysis, 'revision-1');
const tree = evidenceTree(view.evidence);
assert.ok(!JSON.stringify(tree).includes('fire apprentice'));
assert.ok(!JSON.stringify(tree).includes('greater healing'));
const town = view.evidence.find(e => e.title === 'Greyhaven');
const options = { countTokens: async s => Math.ceil(s.length / 4), search: async () => [], budget: 1000 };
const result = await retrieveCanon(view, 'Ari Vale enters.', { ...options, selectedIds: [town.id], purpose: 'generation' });
assert.ok(result.entries.some(e => e.title === 'Greyhaven'), 'A named actor cannot prevent selecting world evidence');
assert.ok(result.entries.some(e => e.title === 'Ari Vale'));
assert.deepEqual(validateSelection({ revision: 'revision-1', ids: [town.id, town.id] }, view.evidence, 'revision-1'), [town.id]);
assert.throws(() => validateSelection({ revision: 'old', ids: [town.id] }, view.evidence, 'revision-1'));
assert.throws(() => validateSelection({ revision: 'revision-1', ids: ['invented'] }, view.evidence, 'revision-1'));
assert.equal((await retrieveCanon(view, 'Ari', { ...options, purpose: 'identity', selectedIds: [town.id] })).status, 'ambiguous');
assert.equal((await retrieveCanon({ ...view, status: 'partial' }, 'Nobody', { ...options, purpose: 'identity' })).status, 'unavailable');
assert.equal((await retrieveCanon(view, 'Nobody', { ...options, purpose: 'identity' })).status, 'no-match');

let saves = 0, chat = 'A';
const legacy = { loreMatrix: [{ id: 'accepted', content: { fact: 'Reviewed fact' } }], loreSelection: { suppressedIds: ['muted'] }, canon: { branch: 'reimagined' } };
const settings = { saga: { enabled: true, semanticCanonEnabled: true, semanticCanonTokenBudget: 700, layer1Sources: { 'ari.png': ['Original'] } }, tunnelvision: { notebookEnabled: true, sidecarPostGenWriter: true } };
const originalSettings = structuredClone(settings), originalLegacy = structuredClone(legacy);
const ctx = { extensionSettings: settings, characters: [{ avatar: 'ari.png' }], characterId: 0, chatMetadata: { saga: legacy }, getCurrentChatId: () => chat, saveMetadata: () => { saves++; } };
globalThis.SillyTavern = { getContext: () => ctx };
assert.equal(getSettings().semanticCanonTokenBudget, 700);
const stateA = getState(); assert.deepEqual(stateA.loreMatrix, legacy.loreMatrix);
stateA.layer1Analysis = { status: 'ready' }; assert.equal(saveState(stateA), true);
assert.deepEqual(settings, originalSettings); assert.deepEqual(legacy, originalLegacy);
chat = 'B'; assert.equal(saveState(stateA), false, 'A result cannot save into a switched chat');
assert.equal(getState().loreMatrix, undefined, 'Reused metadata cannot import another chat during hydration');
assert.equal(saves, 1);

const gated = { id: 'gated', source: { packId: 'test' }, context: { validFromAnchor: 'unknown' }, content: { fact: 'Future fact' } };
assert.equal(getInjectableLoreEntriesForInjection({ loreMatrix: [gated], loredeckContexts: {} }).length, 0);
ctx.ConnectionManagerRequestService = { sendRequest: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) };
await assert.rejects(sendLoreRequest('system', 'data', { profileId: 'test' }));
ctx.ConnectionManagerRequestService.sendRequest = async () => new Promise(() => {});
const controller = new AbortController();
const waiting = sendLoreRequest('system', 'data', { profileId: 'test', signal: controller.signal });
controller.abort(); await assert.rejects(waiting);

const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url)));
assert.equal(manifest.js, 'canon-main.js');
// Traverse the restored runtime to catch missing packaged modules.
const visited = new Set();
async function inspect(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1]; if (!spec.startsWith('.')) continue;
        const dependency = new URL(spec, url);
        if (!dependency.pathname.includes('/TunnelVision/')) continue;
        await inspect(dependency);
    }
}
await inspect(new URL('../../canon-main.js', import.meta.url));
const entry = await readFile(new URL('../../canon-main.js', import.meta.url), 'utf8');
assert.ok(entry.indexOf('enableCanonOwnership();') < entry.indexOf("await import('./index.js')"));
console.log(`Canon port passed: filtered tree, broad selection, revision/ID rejection, identity states, settings preservation, stale save, context gates, provider cancellation, and ${visited.size} packaged runtime modules. Writer activation is checked in the ownership suite.`);
