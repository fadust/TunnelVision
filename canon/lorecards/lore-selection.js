import { normalizeLoreRelevance } from './lore-relevance.js';

function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanId(value = '') {
    return String(value || '').trim();
}

export function normalizeLoreElevationRecords(value = {}) {
    const input = asPlainObject(value);
    const output = {};
    for (const [rawId, rawRecord] of Object.entries(input)) {
        const id = cleanId(rawId);
        if (!id) continue;
        const record = asPlainObject(rawRecord);
        output[id] = {
            elevatedAt: Number.isFinite(Number(record.elevatedAt)) ? Number(record.elevatedAt) : Date.now(),
            previousRelevance: normalizeLoreRelevance(record.previousRelevance || 'normal'),
            previousIsActive: record.previousIsActive === true,
            previousMuted: record.previousMuted === true,
            previousLoreAutomation: asPlainObject(record.previousLoreAutomation),
        };
    }
    return output;
}

export function ensureLoreSelectionShape(state = {}) {
    if (!state || typeof state !== 'object') return { pinnedIds: [], suppressedIds: [], elevated: {} };
    if (!state.loreSelection || typeof state.loreSelection !== 'object' || Array.isArray(state.loreSelection)) {
        state.loreSelection = { pinnedIds: [], suppressedIds: [], elevated: {} };
    }
    const selection = state.loreSelection;
    selection.pinnedIds = Array.isArray(selection.pinnedIds) ? selection.pinnedIds.map(cleanId).filter(Boolean) : [];
    selection.suppressedIds = Array.isArray(selection.suppressedIds) ? selection.suppressedIds.map(cleanId).filter(Boolean) : [];
    selection.elevated = normalizeLoreElevationRecords(selection.elevated);
    return selection;
}

export function getLoreElevationMap(stateOrSelection = {}) {
    const selection = stateOrSelection?.loreSelection ? stateOrSelection.loreSelection : stateOrSelection;
    return normalizeLoreElevationRecords(selection?.elevated || {});
}

export function getElevatedLoreIds(stateOrSelection = {}) {
    return Object.keys(getLoreElevationMap(stateOrSelection));
}

export function getPinnedLoreIds(stateOrSelection = {}) {
    const selection = stateOrSelection?.loreSelection ? stateOrSelection.loreSelection : stateOrSelection;
    return Array.isArray(selection?.pinnedIds) ? selection.pinnedIds.map(cleanId).filter(Boolean) : [];
}

export function isLoreEntryElevated(stateOrSelection = {}, entryId = '') {
    const id = cleanId(entryId);
    return !!id && Object.prototype.hasOwnProperty.call(getLoreElevationMap(stateOrSelection), id);
}

export function getLoreEntryBaseRelevance(entry = {}) {
    return normalizeLoreRelevance(entry?.relevance || 'normal');
}

export function getLoreEntryEffectiveRelevance(entry = {}, stateOrSelection = {}) {
    const id = cleanId(entry?.id);
    if (id) {
        const selection = stateOrSelection?.loreSelection ? stateOrSelection.loreSelection : stateOrSelection;
        if (isLoreEntryElevated(selection, id)) return 'high';
    }
    return getLoreEntryBaseRelevance(entry);
}

export function getLoreSelectionSets(state = {}) {
    const selection = state?.loreSelection || {};
    const pinned = new Set(getPinnedLoreIds(selection));
    const elevated = new Set(getElevatedLoreIds(selection));
    const activePinned = new Set(elevated);
    return {
        muted: new Set(Array.isArray(selection.suppressedIds) ? selection.suppressedIds.map(cleanId).filter(Boolean) : []),
        pinned,
        elevated,
        activePinned,
    };
}

export function isLoreEntryMuted(state = {}, entryId = '') {
    const id = cleanId(entryId);
    if (!id) return false;
    return getLoreSelectionSets(state).muted.has(id);
}
