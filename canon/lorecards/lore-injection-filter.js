/**
 * lore-injection-filter.js -- Saga
 * Shared accepted-Lorecard injection eligibility.
 */

import { evaluateEntryContextGate } from '../context/context-gating.js';
import { getContextIndexSync } from '../context/context-index.js';
import { normalizeLoreMatrix, evaluateLoreEntryLifecycle } from './lore-matrix.js';
import { normalizeLoreRelevance, sortLoreEntriesForInjection } from './lore-relevance.js';
import { getLoreEntryEffectiveRelevance, getLoreSelectionSets } from './lore-selection.js';

function cleanString(value = '', limit = 240) {
    return String(value || '').trim().slice(0, limit);
}

function numericLimit(value = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function getContextIndex(options = {}) {
    return options.contextIndex || options.index || getContextIndexSync() || null;
}

export function getLoreEntryInjectionContextGate(entry = {}, state = {}, options = {}) {
    const result = evaluateEntryContextGate(entry, state, {
        index: getContextIndex(options),
        unresolvedEligible: options.unresolvedEligible === true,
    });
    return {
        eligible: result.eligible !== false,
        status: cleanString(result.status, 80),
        reason: cleanString(result.reason, 500),
        hasGate: result.hasGate === true,
        packId: cleanString(result.packId, 160),
    };
}

export function getInjectableLoreEntriesForInjection(state = {}, options = {}) {
    const all = normalizeLoreMatrix(state?.loreMatrix || []);
    const { muted, elevated, activePinned } = getLoreSelectionSets(state);
    const tier = options.relevance ? normalizeLoreRelevance(options.relevance) : null;
    const injectable = all
        .filter(entry => entry.status !== 'archived' && entry.status !== 'disabled')
        .filter(entry => entry.injectableByDefault !== false)
        .filter(entry => !muted.has(entry.id))
        .filter(entry => evaluateLoreEntryLifecycle(entry, state).shouldInject)
        .filter(entry => !tier || getLoreEntryEffectiveRelevance(entry, state) === tier)
        .filter(entry => getLoreEntryInjectionContextGate(entry, state, options).eligible)
        .map(entry => ({
            ...entry,
            baseRelevance: normalizeLoreRelevance(entry.relevance),
            isElevated: elevated.has(entry.id),
            isPinned: activePinned.has(entry.id),
            isSuppressed: false,
            isActive: getLoreEntryEffectiveRelevance(entry, state) === 'high',
            relevance: getLoreEntryEffectiveRelevance(entry, state),
        }));
    const sorted = sortLoreEntriesForInjection(injectable, activePinned);
    const limit = numericLimit(options.limit);
    if (limit <= 0) return sorted;
    const pinnedEntries = sorted.filter(entry => entry.isPinned);
    const regularEntries = sorted.filter(entry => !entry.isPinned).slice(0, limit);
    return [...pinnedEntries, ...regularEntries];
}

export function getInjectableLoreEntriesByRelevanceForInjection(state = {}, relevance = 'normal', limit = 0, options = {}) {
    return getInjectableLoreEntriesForInjection(state, {
        ...options,
        relevance,
        limit,
    });
}
