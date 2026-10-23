import { getSettings, getState, saveState } from '../state/state-manager.js';
import { sendLoreRequest } from '../providers/lore-llm-client.js';
import { evidenceTree, validateSelection, SELECTION_PROMPT } from './tree-selection.js';
import { buildCanonQuery } from './semantic-canon-index.js';
import { canonHash, compileCanon, analysisSummary, retrieveCanon, formatCanonEvidence, CANON_ANALYSIS_PROMPT, CANON_SCHEMA_VERSION } from './layer1-model.js';
import { createCanonStore } from './layer1-store.js';
import { getInjectableLoreEntriesForInjection, getLoreEntryInjectionContextGate } from '../lorecards/lore-injection-filter.js';
import { separateConditions, hasEvaluableConditions, mapSelectiveLogic } from '../../conditions.js';

export const SEMANTIC_CANON_PROMPT_KEY = 'tunnelvision_semantic_canon';
const host = () => globalThis.SillyTavern?.getContext?.();
export const canonCardKey = () => host()?.characters?.[host()?.characterId]?.avatar || '';
const chatKey = () => String(host()?.getCurrentChatId?.() || host()?.chatId || '');
const profileRevision = () => {
    const extensions = host()?.extensionSettings, id = (extensions?.npc_codex || extensions?.npc_state_delta)?.scannerConnectionProfile;
    const sidecar = extensions?.tunnelvision?.sidecarProfile;
    return JSON.stringify(sidecar?.enabled ? sidecar : extensions?.connectionManager?.profiles?.find(p => p.id === id) || id || '');
};
const scannerProfile = () => (host()?.extensionSettings?.npc_codex || host()?.extensionSettings?.npc_state_delta)?.scannerConnectionProfile;
const modelConfiguration = () => getSettings().tunnelvision?.embeddingProfile?.enabled ? getSettings().tunnelvision.embeddingProfile : [getSettings().semanticCanonModel, getSettings().semanticCanonApiUrl];
const modelRevision = () => JSON.stringify(modelConfiguration());
const canonBudget = () => Math.min(1000, getSettings().semanticCanonTokenBudget || 1000, getSettings().tunnelvision?.sidecarMaxInjectionTokens || 1000);
let canonRevision = 0; // Source lifetime is independent of temporary generation prompts.
let revision = 0, running = null, current = null, controller = null, wired = false;
let lastResult = { entries: [], text: '', status: 'idle' };
let previous = null, generation = null, nativeApproved = new Set();
const nativeDelivered = new Set();
const metrics = { analysisCalls: 0, embeddingCalls: 0, analysisCacheHits: 0, queryCacheHits: 0, analysisInputEstimatedTokens: 0, providerReportedInputTokens: null, providerReportedOutputTokens: null, retrievalMs: 0 };
const queryCache = new Map();
let treeSelection = null, selectionController = null;
const toolDelivered = new Map();
let nativeApiPromise;
const nativeApi = () => nativeApiPromise ||= import('../../../../../world-info.js');
export const selectedCanonBooks = () => (getSettings().layer1Sources?.[canonCardKey()] || []).filter(book => getSettings().tunnelvision?.bookPermissions?.[book] !== 'write_only');

function setPrompt(text) {
    const s = getSettings();
    host()?.setExtensionPrompt?.(SEMANTIC_CANON_PROMPT_KEY, text, s.loreInjectionPosition ?? 1, s.loreInjectionDepth ?? 3, false, s.loreInjectionRole ?? 0);
}
function setEvidencePrompts(entries = []) {
    setPrompt('');
    const settings = getSettings();
    const smart = settings.tunnelvision?.smartContextEnabled ? settings.tunnelvision : null;
    for (const tier of ['high', 'normal', 'low']) {
        const prefix = `lore${tier[0].toUpperCase()}${tier.slice(1)}`;
        const text = settings[`${prefix}InjectionEnabled`] === false ? '' : formatCanonEvidence(entries.filter(e => (e.tier || 'normal') === tier && !nativeDelivered.has(e.id)));
        host()?.setExtensionPrompt?.(`tunnelvision_lore_${tier}_relevance`, text,
            smart ? (smart.smartContextPosition === 'in_prompt' ? 0 : 1) : settings[`${prefix}InjectionPosition`] ?? settings.loreInjectionPosition ?? 1,
            smart ? smart.smartContextDepth ?? 3 : settings[`${prefix}InjectionDepth`] ?? settings.loreInjectionDepth ?? 3, false,
            smart ? ({ system: 0, user: 1, assistant: 2 }[smart.smartContextRole] ?? 0) : settings[`${prefix}InjectionRole`] ?? settings.loreInjectionRole ?? 0);
    }
}
export function syncCanonPrompts() {
    if (!current || !generation || !getSettings().enabled || generation.key !== current.key || current.context !== JSON.stringify(getState().loreContext || {}) || getSettings().injectLore === false) {
        clearSemanticCanon(); return;
    }
    setEvidencePrompts(generation.entries.filter(e => e.basis.every(b => !b.source.startsWith('book:') || nativeApproved.has(b.source))));
}
export function clearSemanticCanon(keepPreview = false) {
    revision++; generation = null;
    nativeDelivered.clear();
    toolDelivered.clear();
    if (!keepPreview) lastResult = { entries: [], text: '', status: 'cleared' };
    setEvidencePrompts();
}
export function invalidateCanon() {
    selectionController?.abort(); treeSelection = null;
    canonRevision++;
    if (current) previous = current;
    clearSemanticCanon(); queryCache.clear(); nativeApproved.clear(); controller?.abort(); current = null; running = null;
    const state = getState();
    if (state.layer1Analysis) state.layer1Analysis.status = 'stale';
}
function storeFor(settings) {
    return createCanonStore({ fetch: (...args) => fetch(...args), headers: () => host().getRequestHeaders(),
        embed: async (texts, signal) => {
            metrics.embeddingCalls++;
            if (settings.tunnelvision?.embeddingProfile?.enabled) {
                const { computeEmbeddings } = await import('../../llm-sidecar.js');
                const result = await computeEmbeddings(texts, { signal }); signal?.throwIfAborted(); return result;
            }
            const response = await fetch('/api/plugins/similharity/batch-embeddings', {
                method: 'POST', headers: host().getRequestHeaders(), signal,
                body: JSON.stringify({ source: 'vllm', model: settings.semanticCanonModel, apiUrl: settings.semanticCanonApiUrl, texts }),
            });
            if (!response.ok) throw new Error(`Canon embedding HTTP ${response.status}`);
            return (await response.json()).embeddings;
        } });
}

async function sources() {
    const ctx = host(), card = ctx?.characters?.[ctx.characterId];
    if (!card) throw new Error('Select a character card for canon retrieval');
    const rows = ['name', 'description', 'personality', 'scenario'].map((field, uid) => ({
        id: `card:${canonCardKey()}:${field}`, kind: 'card', uid, text: String(card[field] ?? card.data?.[field] ?? ''),
    })).filter(s => s.text.trim());
    const api = await nativeApi();
    for (const world of selectedCanonBooks()) {
        const book = await api.loadWorldInfo(world);
        if (!book?.entries) throw new Error(`Canon source unavailable: ${world}`);
        const uids = new Set();
        for (const entry of Object.values(book.entries)) {
            if (entry.uid == null || uids.has(String(entry.uid))) throw new Error(`Duplicate or missing UID in ${world}`);
            uids.add(String(entry.uid));
            if (entry.disable || !String(entry.content || '').trim()) continue;
            rows.push({ id: `book:${world}:${entry.uid}`, kind: 'lorebook', world, uid: entry.uid, text: entry.content, rules: entry });
        }
    }
    return rows;
}

async function publishSummary(summary, view, rows) {
    const state = getState();
    const validations = await Promise.all((state.loreMatrix || []).filter(entry => entry.extensions?.layer1 && rows).map(async entry => {
        const layer = entry.extensions.layer1, basis = layer.basis.map(id => rows.find(row => row.id === id));
        return { layer, stale: basis.some(row => !row) || await canonHash(basis) !== layer.basisRevision };
    }));
    if (view && current?.key !== summary.revision) return;
    state.layer1Analysis = summary;
    const accepted = new Set((state.loreMatrix || []).map(e => e.id));
    const pending = state.pendingLoreEntries ||= [];
    const known = new Set([...pending.map(e => e.id), ...Object.keys(state.layer1Decisions || {})]);
    let created = 0;
    for (const p of view?.proposals || []) {
        const old = pending.find(e => e.id === p.id);
        if (old) old.extensions.layer1 = p.extensions.layer1;
        else if (!known.has(p.id) && !accepted.has(p.id)) { pending.push(p); created++; }
    }
    summary.proposalsCreated = created;
    for (const { layer, stale } of validations) {
        layer.stale = stale;
        if (!layer.stale) layer.revision = summary.revision;
    }
    saveState(state);
    document.dispatchEvent(new CustomEvent('tunnelvision:canon-analysis', { detail: summary }));
}

export async function analyzeCanonSources({ force = false } = {}) {
    if (getSettings().enabled === false || !getSettings().semanticCanonEnabled || !canonCardKey()) return null;
    if (running && !force) return running;
    controller?.abort(); const ownController = new AbortController(); controller = ownController;
    const signal = AbortSignal.any([ownController.signal, AbortSignal.timeout(120000)]);
    const owner = `${canonCardKey()}|${chatKey()}`, settings = getSettings();
    const store = storeFor(settings);
    let pendingSummary;
    running = (async () => {
        const rows = await sources(); signal.throwIfAborted();
        const context = getState().loreContext || {};
        const profile = profileRevision();
        const key = await canonHash({ rows, context, profile, prompt: CANON_ANALYSIS_PROMPT, schema: CANON_SCHEMA_VERSION });
        if (!force && current?.view.revision === key) return current;
        const prior = current || (previous?.owner === owner ? previous : null) || await store.get('latest', owner, signal);
        let changed = rows.map(s => s.id);
        if (prior) changed = [...new Set([...rows, ...prior.rows].filter(row => !rows.some(a => a.id === row.id && prior.rows.some(b => b.id === a.id && JSON.stringify(a) === JSON.stringify(b)))).map(s => s.id))];
        pendingSummary = { revision: key, status: 'analyzing', changedSources: changed, entities: [], proposalsCreated: 0, proposalIds: [], at: Date.now() };
        getState().layer1Analysis = pendingSummary;
        document.dispatchEvent(new CustomEvent('tunnelvision:canon-analysis', { detail: pendingSummary }));
        const cached = await store.get('analysis', key, signal);
        let view = cached?.view;
        if (view) metrics.analysisCacheHits++;
        else {
            const profileId = scannerProfile();
            if (!profileId && !settings.tunnelvision?.sidecarProfile?.enabled) throw new Error('Select a TunnelVision sidecar or NPC Codex scanner connection profile');
            const cardRows = rows.filter(s => s.kind === 'card');
            const batches = [];
            let batch = [], size = 0;
            // shortcut: one source entry stays whole; add passage chunking if real entries exceed provider capacity.
            for (const row of rows.filter(s => s.kind !== 'card')) {
                if (size + row.text.length > 24000 && batch.length) { batches.push([...cardRows, ...batch]); batch = []; size = 0; }
                batch.push(row); size += row.text.length;
            }
            if (batch.length) batches.push([...cardRows, ...batch]);
            if (!batches.length) batches.push(cardRows);
            const analysis = { entities: [], facts: [], proposals: [], timeShift: null };
            for (const batchRows of batches) {
                const cleanRows = batchRows.map(({ rules, ...s }) => s);
                const batchKey = await canonHash([cleanRows, context, profile, CANON_ANALYSIS_PROMPT]);
                let part = await store.get('source-analysis', batchKey, signal);
                if (part) metrics.analysisCacheHits++;
                else {
                    const prompt = JSON.stringify({ sources: cleanRows, context });
                    metrics.analysisInputEstimatedTokens += Math.ceil((CANON_ANALYSIS_PROMPT.length + prompt.length) / 4);
                    const response = await sendLoreRequest(CANON_ANALYSIS_PROMPT, prompt, { profileId, signal, maxTokens: 8192, maxRetries: 0,
                        onRequest: () => { metrics.analysisCalls++; }, onUsage: usage => {
                            if (Number.isFinite(usage?.prompt_tokens)) metrics.providerReportedInputTokens = (metrics.providerReportedInputTokens || 0) + usage.prompt_tokens;
                            if (Number.isFinite(usage?.completion_tokens)) metrics.providerReportedOutputTokens = (metrics.providerReportedOutputTokens || 0) + usage.completion_tokens;
                        } });
                    signal.throwIfAborted();
                    const raw = typeof response === 'string' ? response : response?.content;
                    part = JSON.parse(String(raw).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
                    await compileCanon(batchRows, part, key);
                    await store.set('source-analysis', batchKey, part, signal);
                }
                const ids = new Map();
                for (const entity of part.entities) {
                    const prior = analysis.entities.find(e => e.name.toLowerCase() === entity.name.toLowerCase());
                    const id = prior?.id || await canonHash(entity.name.normalize('NFKC').toLowerCase());
                    ids.set(entity.id, id);
                    if (prior) { prior.aliases = [...new Set([...(prior.aliases || []), ...(entity.aliases || [])])]; prior.reimagined ||= entity.reimagined; }
                    else analysis.entities.push({ ...structuredClone(entity), id, dependencies: [] });
                }
                for (const entity of part.entities) {
                    const merged = analysis.entities.find(e => e.id === ids.get(entity.id));
                    merged.dependencies = [...new Set([...merged.dependencies, ...(entity.dependencies || []).map(id => ids.get(id)).filter(Boolean)])];
                }
                analysis.facts.push(...part.facts.map(f => ({ ...f, entity: ids.get(f.entity) || f.entity })));
                analysis.proposals.push(...(part.proposals || []).map(p => ({ ...p, entity: ids.get(p.entity) || p.entity })));
                analysis.timeShift ||= part.timeShift;
            }
            view = await compileCanon(rows, analysis, key);
            await store.set('analysis', key, { view }, signal);
        }
        const model = await canonHash(modelConfiguration());
        const scope = await store.index(view, model, signal);
        signal.throwIfAborted();
        if (`${canonCardKey()}|${chatKey()}` !== owner || controller !== ownController) return null;
        await store.set('latest', owner, { view, rows }, signal);
        signal.throwIfAborted();
        if (`${canonCardKey()}|${chatKey()}` !== owner || controller !== ownController) return null;
        current = { view, rows, store, scope, key, owner, profile, context: JSON.stringify(context), model: modelRevision() };
        await publishSummary(analysisSummary(view, changed, prior?.view), view, rows);
        return current;
    })().catch(async error => {
        if (ownController.signal.aborted || `${canonCardKey()}|${chatKey()}` !== owner) return null;
        current = null;
        await publishSummary({ revision: '', changedSources: [], entities: [], proposalsCreated: 0, proposalIds: [], at: Date.now(), ...pendingSummary, status: 'failed', error: error.message });
        return null;
    }).finally(() => { if (controller === ownController) running = null; });
    return running;
}

export async function querySemanticCanon(scene, { signal, purpose = 'story' } = {}) {
    const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    let onAbort;
    const abort = new Promise((_, reject) => { onAbort = () => reject(boundedSignal.reason); boundedSignal.addEventListener('abort', onAbort, { once: true }); });
    try { return structuredClone(await Promise.race([query(scene, purpose, boundedSignal), abort])); }
    catch { return { status: 'unavailable', entries: [], text: '' }; }
    finally { boundedSignal.removeEventListener('abort', onAbort); }
}

async function query(scene, purpose, signal) {
    signal.throwIfAborted();
    if (!getSettings().semanticCanonEnabled || getSettings().enabled === false) return { status: 'unavailable', entries: [], text: '' };
    if (!current || current.owner !== `${canonCardKey()}|${chatKey()}` || current.profile !== profileRevision() || current.model !== modelRevision() || current.context !== JSON.stringify(getState().loreContext || {})) {
        if (current) invalidateCanon();
        void analyzeCanonSources(); return partialEvidence(scene, purpose, signal);
    }
    const start = performance.now(), snapshot = current;
    const rows = await sources();
    if (JSON.stringify(rows) !== JSON.stringify(snapshot.rows)) { invalidateCanon(); void analyzeCanonSources(); return partialEvidence(scene, purpose, signal, rows); }
    const state = getState();
    const view = eligibleView(snapshot, purpose);
    const accepted = view.evidence.filter(e => e.kind === 'user-approved interpretation');
    const cacheKey = JSON.stringify([snapshot.key, purpose, scene, state.loreContext, accepted, state.loreSelection, [...nativeApproved], getSettings().semanticCanonTokenBudget,
        treeSelection, canonBudget(), getSettings().tunnelvision?.smartContextEnabled, getSettings().tunnelvision?.smartContextMaxChars, getSettings().tunnelvision?.smartContextMaxEntries, getSettings().tunnelvision?.totalInjectionBudget, ...['High', 'Normal', 'Low'].map(tier => getSettings()[`lore${tier}InjectionEnabled`])]);
    if (queryCache.has(cacheKey)) { metrics.queryCacheHits++; return structuredClone(queryCache.get(cacheKey)); }
    const selection = treeSelection?.key === snapshot.key && treeSelection?.scene === scene ? treeSelection.ids : null;
    const result = await retrieveCanon(view, scene, { purpose, signal, selectedIds: selection, budget: canonBudget(),
        countTokens: text => host().getTokenCountAsync(text), search: (text, abortSignal) => snapshot.store.search(snapshot.scope, text, abortSignal) });
    if (purpose === 'generation' || purpose === 'story') {
        const tv = getSettings().tunnelvision || {}, limited = [];
        const charBudget = Math.min(tv.totalInjectionBudget || Infinity, tv.smartContextEnabled ? tv.smartContextMaxChars || Infinity : Infinity);
        for (const entry of result.entries) {
            if (tv.smartContextEnabled && limited.length >= (tv.smartContextMaxEntries || 8)) break;
            const candidate = [...limited, entry];
            const rendered = Object.values(tv.bookInjectionModes || {}).includes('native')
                ? candidate.map(e => formatCanonEvidence([e])).join('\n\n') : formatCanonEvidence(candidate);
            if (rendered.length <= charBudget && await host().getTokenCountAsync(rendered) <= canonBudget()) limited.push(entry);
        }
        result.entries = limited; result.text = formatCanonEvidence(limited);
    }
    const restricted = entry => entry.basis.some(b => hasNativeRestrictions(snapshot.rows.find(r => r.id === b.source)?.rules) && (!generation || !nativeApproved.has(b.source)));
    if (purpose !== 'generation' && result.entries.some(restricted)) {
        result.status = 'unavailable'; result.restrictionStatus = 'awaiting-native-activation';
        result.entries = result.entries.filter(entry => !restricted(entry));
        result.text = result.entries.map(e => `[${e.kind}: ${e.title}]\n${e.text}`).join('\n\n');
    }
    signal.throwIfAborted(); if (current !== snapshot) return { status: 'unavailable', entries: [], text: '' };
    metrics.retrievalMs = performance.now() - start;
    if (queryCache.size >= 12) queryCache.delete(queryCache.keys().next().value);
    queryCache.set(cacheKey, structuredClone(result));
    return result;
}

function eligibleView(snapshot, purpose) {
    const state = getState();
    const muted = new Set(state.loreSelection?.suppressedIds || []);
    const accepted = getInjectableLoreEntriesForInjection(state).filter(e => e.extensions?.layer1?.revision === snapshot.key && !e.extensions.layer1.stale);
    const evidence = snapshot.view.evidence.filter(e => !muted.has(e.id) && getLoreEntryInjectionContextGate(e.restrictions || {}, state).eligible)
        .map(e => ({ ...e, elevated: !!state.loreSelection?.elevated?.[e.id], tier: state.loreSelection?.elevated?.[e.id] ? 'high' : 'normal' }));
    const view = { ...snapshot.view, evidence: [...evidence, ...accepted.map(e => ({ id: e.id, entity: e.extensions.layer1.entity,
        title: e.title, text: e.content?.injection || e.content?.fact || '', kind: 'user-approved interpretation',
        basis: e.extensions.layer1.basis.map(source => ({ source, quote: snapshot.rows.find(r => r.id === source)?.text || '' })), revision: snapshot.key, world: 'interpretation', uid: 0,
        tier: e.relevance, elevated: e.isElevated, restrictions: e.context, version: 'user-approved' }))] };
    if (purpose === 'story' || purpose === 'generation') view.evidence = view.evidence.filter(e => getSettings()[`lore${(e.tier || 'normal')[0].toUpperCase()}${(e.tier || 'normal').slice(1)}InjectionEnabled`] !== false);
    if (purpose !== 'selection' && getSettings().tunnelvision?.conditionalTriggersEnabled !== false) view.evidence = view.evidence.filter(e => !hasEvaluableConditions(e.restrictions || {}) || treeSelection?.conditionIds?.includes(e.id));
    return view;
}

async function partialEvidence(scene, purpose, signal, rows) {
    const prior = previous;
    if (!prior || prior.owner !== `${canonCardKey()}|${chatKey()}`) return { status: 'unavailable', entries: [], text: '' };
    rows ||= await sources();
    const unchanged = new Set(rows.filter(row => prior.rows.some(old => old.id === row.id && JSON.stringify(old) === JSON.stringify(row))).map(row => row.id));
    const cardChanged = prior.rows.some(row => row.kind === 'card' && !unchanged.has(row.id));
    const affected = new Set(prior.view.evidence.filter(e => !e.basis.every(b => unchanged.has(b.source))).map(e => e.entity));
    let expanded;
    do {
        expanded = false;
        for (const entity of prior.view.entities) if (!affected.has(entity.id) && (entity.dependencies || []).some(id => affected.has(id))) {
            affected.add(entity.id); expanded = true;
        }
    } while (expanded);
    const muted = new Set(getState().loreSelection?.suppressedIds || []);
    const evidence = prior.view.evidence.filter(e => e.basis.every(b => unchanged.has(b.source)) && !muted.has(e.id)
        && !affected.has(e.entity) && !(cardChanged && e.version === 'reimagined') && !hasNativeRestrictions(e.restrictions)
        && getLoreEntryInjectionContextGate(e.restrictions || {}, getState()).eligible);
    return retrieveCanon({ ...prior.view, status: 'partial', evidence }, scene, { purpose, signal, budget: 1000,
        countTokens: text => host().getTokenCountAsync(text), search: async () => null });
}

export async function prepareSemanticCanon(chat, type) {
    // Tool recursion uses the existing generation ledger instead of starting another selector.
    if (generation && chat?.at(-1)?.extra?.tool_invocations) return;
    selectionController?.abort(); treeSelection = null;
    clearSemanticCanon(); nativeApproved.clear(); if (type === 'quiet' || !getSettings().enabled || !getSettings().semanticCanonEnabled || getSettings().injectLore === false) return;
    const own = revision, owner = chatKey();
    const tv = getSettings().tunnelvision || {};
    const scene = buildCanonQuery(chat, tv.sidecarContextMessages || (tv.smartContextEnabled ? tv.smartContextLookback : 3));
    // The pre-generation selector is separate from the bounded, read-only Codex query API.
    const selectionAbort = new AbortController(); selectionController = selectionAbort;
    const signal = AbortSignal.any([selectionAbort.signal, AbortSignal.timeout(tv.llmCallTimeout || 120000)]);
    const snapshot = await analyzeCanonSources();
    if (own !== revision || owner !== chatKey() || signal.aborted) return;
    if (snapshot && (tv.sidecarAutoRetrieval !== false || (tv.conditionalTriggersEnabled !== false && snapshot.view.evidence.some(e => hasEvaluableConditions(e.restrictions || {}))))) {
        try {
            const view = eligibleView(snapshot, 'selection');
            const conditions = tv.conditionalTriggersEnabled === false ? [] : view.evidence.filter(e => hasEvaluableConditions(e.restrictions || {})).map(e => ({
                evidence_id: e.id, primary: separateConditions(e.restrictions.key || []).conditions,
                secondary: separateConditions(e.restrictions.keysecondary || []).conditions,
                logic: e.restrictions.selective ? mapSelectiveLogic(e.restrictions.selectiveLogic ?? 0) : 'AND_ANY',
            }));
            const tree = tv.trees ? (await import('../search.js')).canonSelectionTree(view.evidence) : evidenceTree(view.evidence);
            const prompt = JSON.stringify({ revision: snapshot.key, scene, tree, conditions });
            if (prompt.length > 96000) throw new Error('Canon tree exceeds selector input budget; no silent truncation');
            const instruction = conditions.length ? SELECTION_PROMPT + '\nAlso return conditional_evaluations:[{evidence_id,met:boolean}] for every supplied condition group. Evaluate scene predicates strictly, honor negation and AND_ANY/AND_ALL/NOT_ANY/NOT_ALL logic. They are scene filters, never new canon facts.' : SELECTION_PROMPT;
            const response = await sendLoreRequest(instruction, prompt, { profileId: scannerProfile(), signal, maxTokens: tv.sidecarProfile?.maxTokens || 4096 });
            const raw = JSON.parse(response.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
            const ids = validateSelection(raw, view.evidence, snapshot.key);
            const conditionIds = conditions.filter(c => raw.conditional_evaluations?.some(e => e.evidence_id === c.evidence_id && e.met === true)).map(c => c.evidence_id);
            signal.throwIfAborted();
            if (own !== revision || current !== snapshot || owner !== chatKey()) return;
            treeSelection = { key: snapshot.key, scene, ids, conditionIds };
        } catch (error) {
            if (signal.aborted || own !== revision || owner !== chatKey()) return;
            console.warn('[TunnelVision canon] Tree selection unavailable; using validated exact/vector evidence only', error);
        }
    }
    const result = await querySemanticCanon(scene, { purpose: 'generation', signal });
    if (own !== revision || owner !== chatKey()) return;
    lastResult = result;
    generation = { revision: own, key: current?.key, entries: result.entries || [] };
    // Book passages await the host's native activation rules; card evidence is immediately usable.
    setEvidencePrompts(generation.entries.filter(e => !current || e.basis.every(b => !b.source.startsWith('book:'))));
}
export function canonToolPreview() {
    if (!current || !getSettings().enabled || !getSettings().semanticCanonEnabled || current.owner !== `${canonCardKey()}|${chatKey()}` || current.profile !== profileRevision() || current.model !== modelRevision() || current.context !== JSON.stringify(getState().loreContext || {})) return { revision: '', evidence: [] };
    const view = eligibleView(current, 'story');
    return { revision: current.key, evidence: view.evidence.filter(e => e.basis.every(b => !hasNativeRestrictions(current.rows.find(r => r.id === b.source)?.rules) || nativeApproved.has(b.source))) };
}
export async function canonToolView() {
    if (!getSettings().enabled || !getSettings().semanticCanonEnabled) return null;
    const snapshot = current;
    if (!canonToolPreview().revision) { if (snapshot) invalidateCanon(); void analyzeCanonSources(); return null; }
    try {
        if (JSON.stringify(await sources()) !== JSON.stringify(snapshot.rows)) { invalidateCanon(); void analyzeCanonSources(); return null; }
    } catch { invalidateCanon(); return null; }
    return current === snapshot ? canonToolPreview() : null;
}
export async function retrieveCanonTool(expectedRevision, ids) {
    const view = await canonToolView(), epoch = revision;
    if (!view || view.revision !== expectedRevision) return 'Canon evidence unavailable or stale. Navigate the current tree again.';
    const allowed = new Map(view.evidence.map(e => [e.id, e]));
    if (ids.some(id => !allowed.has(id))) return 'Unknown, restricted or stale evidence ID.';
    const delivered = new Map([...(generation?.entries || []).map(e => [e.id, e]), ...toolDelivered]);
    const entries = [], settings = getSettings();
    const tokens = text => host().getTokenCountAsync(formatCanonEvidence(text));
    for (const id of ids) {
        const entry = allowed.get(id);
        if (delivered.has(id) || [...delivered.values()].some(e => e.text === entry.text)) continue;
        if (await tokens([...delivered.values(), entry]) > canonBudget()) continue;
        if (settings.tunnelvision?.totalInjectionBudget > 0 && formatCanonEvidence([...delivered.values(), entry]).length > settings.tunnelvision.totalInjectionBudget) continue;
        delivered.set(id, entry); entries.push(entry);
    }
    if (epoch !== revision || view.revision !== current?.key) return 'Canon evidence changed during retrieval; retry.';
    entries.forEach(e => toolDelivered.set(e.id, e));
    return entries.length ? formatCanonEvidence(entries) : ids.length ? 'Matching evidence is already in the canon context or exceeds the remaining shared budget.' : 'No eligible matching evidence; this does not establish a completed canon no-match.';
}
export function semanticCanonRevision() { return `${chatKey()}|${canonRevision}|${current?.key || ''}|${getSettings().enabled !== false && !!getSettings().semanticCanonEnabled}`; }
export function semanticCanonStatus() {
    return { status: lastResult.status, summary: getState().layer1Analysis || null, metrics: { ...metrics },
        enabled: getSettings().enabled !== false && !!getSettings().semanticCanonEnabled,
        evidence: structuredClone(current?.view.evidence || []),
        selected: structuredClone(lastResult.entries || []), text: lastResult.text || '',
        selector: treeSelection ? 'ready' : 'unavailable', memoryWriters: false };
}
export function installCanonEvents() {
    if (wired) return; wired = true;
    const ctx = host(), events = ctx.eventTypes || ctx.event_types || {};
    document.addEventListener('tunnelvision:canon-options', () => { invalidateCanon(); void analyzeCanonSources(); });
    for (const name of ['CHAT_CHANGED', 'CHARACTER_EDITED', 'WORLDINFO_UPDATED', 'WORLDINFO_DELETED', 'WORLDINFO_SETTINGS_UPDATED']) {
        if (events[name]) ctx.eventSource.on(events[name], () => { invalidateCanon(); void analyzeCanonSources(); });
    }
    if (events.WORLDINFO_ENTRIES_LOADED) ctx.eventSource.on(events.WORLDINFO_ENTRIES_LOADED, groups => {
        if (!getSettings().semanticCanonEnabled || getSettings().enabled === false) return;
        const managed = new Set(selectedCanonBooks());
        for (const rows of Object.values(groups)) if (Array.isArray(rows)) for (let i = rows.length - 1; i >= 0; i--) if (managed.has(rows[i].world)) rows.splice(i, 1);
        if (!current || !generation || generation.key !== current.key) return;
        const bySource = new Map();
        for (const entry of generation.entries) for (const basis of entry.basis) if (basis.source.startsWith('book:')) {
            const list = bySource.get(basis.source) || []; list.push(entry); bySource.set(basis.source, list);
        }
        const placed = new Set();
        for (const source of bySource.keys()) {
            const row = current.rows.find(r => r.id === source);
            if (!row) continue;
            // An empty outlet suppresses native text injection while retaining the native eligibility engine.
            const decorators = (row.text.match(/^@@[^\r\n]*/gm) || []).join('\n');
            const native = getSettings().tunnelvision?.bookInjectionModes?.[row.world] === 'native';
            const primary = separateConditions(row.rules.key || []).keywords, secondary = separateConditions(row.rules.keysecondary || []).keywords;
            const nativeEntries = native ? bySource.get(source).filter(e => !placed.has(e.id) && e.basis.every(b => b.source === source || b.source.startsWith('card:'))) : [];
            nativeEntries.forEach(e => placed.add(e.id));
            groups.globalLore.push({ ...row.rules, world: row.world, uid: row.uid,
                key: primary, keysecondary: secondary, selective: row.rules.selective && secondary.length > 0,
                content: [decorators, formatCanonEvidence(nativeEntries)].filter(Boolean).join('\n'),
                constant: row.rules.constant || (!getSettings().tunnelvision?.allowKeywordTriggers && !secondary.length) || (hasEvaluableConditions(row.rules) && !primary.length),
                ...(native ? {} : { position: 7, outletName: '' }), layer1Source: source, tunnelvisionNativeIds: nativeEntries.map(e => e.id) });
        }
    });
    if (events.WORLD_INFO_ACTIVATED) ctx.eventSource.on(events.WORLD_INFO_ACTIVATED, entries => {
        if (!current || !generation || generation.revision !== revision || generation.key !== current.key) return;
        nativeApproved = new Set(entries.filter(e => e.layer1Source).map(e => e.layer1Source));
        const approved = generation.entries.filter(e => e.basis.every(b => !b.source.startsWith('book:') || nativeApproved.has(b.source)));
        nativeDelivered.clear();
        for (const row of entries) for (const id of row.tunnelvisionNativeIds || []) nativeDelivered.add(id);
        lastResult = { ...lastResult, entries: approved, text: approved.map(e => `[${e.kind}: ${e.title}]\n${e.text}`).join('\n\n') };
        setEvidencePrompts(approved);
    });
    for (const name of ['GENERATION_STOPPED', 'GENERATION_FAILED', 'GENERATION_ABORTED']) if (events[name]) ctx.eventSource.on(events[name], () => { selectionController?.abort(); clearSemanticCanon(); });
    if (events.GENERATION_ENDED) ctx.eventSource.on(events.GENERATION_ENDED, () => clearSemanticCanon(true));
    void analyzeCanonSources();
}

function hasNativeRestrictions(r = {}) {
    return !!(hasEvaluableConditions(r) || r.disable || r.characterFilter?.names?.length || r.characterFilter?.tags?.length || r.triggers?.length
        || r.cooldown || r.delay || r.sticky || r.delayUntilRecursion || r.excludeRecursion || r.group
        || (r.useProbability && Number(r.probability) < 100) || r.keysecondary?.length
        || /@@dont_activate/.test(r.content || ''));
}
