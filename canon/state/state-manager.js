// Read existing Layer 1 decisions without rewriting Saga's settings or drafts.
const owners = new WeakMap();
const snapshots = new WeakMap();
const host = () => globalThis.SillyTavern?.getContext?.();
const identity = ctx => `${ctx?.characters?.[ctx.characterId]?.avatar || ''}|${ctx?.getCurrentChatId?.() || ctx?.chatId || ''}`;
export function getSettings() {
    const ext = host()?.extensionSettings || {};
    const own = ext.tunnelvision?.canon || {};
    return { semanticCanonTokenBudget: 1000, ...ext.saga, ...own,
        tunnelvision: ext.tunnelvision || {},
        enabled: ext.tunnelvision?.globalEnabled !== false && own.enabled !== false,
        semanticCanonEnabled: own.semanticCanonEnabled ?? ext.saga?.semanticCanonEnabled ?? true };
}
export function getState() {
    const ctx = host(), metadata = ctx?.chatMetadata;
    if (!metadata) return {};
    const key = identity(ctx);
    let cached = snapshots.get(metadata);
    if (cached?.key === key && cached.persisted === metadata.tunnelvisionCanon && cached.legacy === metadata.saga) return cached.state;
    const own = metadata.tunnelvisionCanon;
    const reusedLegacy = cached && cached.key !== key && cached.legacy === metadata.saga;
    const prior = own?.ownerKey === key ? own : reusedLegacy ? {} : metadata.saga || {};
    const fields = ['loreContext', 'loreMatrix', 'pendingLoreEntries', 'loreSelection', 'layer1Decisions', 'layer1Analysis', 'loredeckContexts', 'contextIndex', 'canon', 'scene', 'storyMilestones'];
    const state = structuredClone(Object.fromEntries(fields.filter(k => prior[k] !== undefined).map(k => [k, prior[k]])));
    owners.set(state, { metadata, key });
    snapshots.set(metadata, { key, state, persisted: own, legacy: metadata.saga });
    return state;
}
export function saveState(state) {
    const ctx = host(), owner = owners.get(state);
    if (!owner || owner.metadata !== ctx?.chatMetadata || owner.key !== identity(ctx)) return false;
    ctx.chatMetadata.tunnelvisionCanon = { ...structuredClone(state), ownerKey: owner.key };
    const cached = snapshots.get(owner.metadata);
    if (cached?.state === state) cached.persisted = ctx.chatMetadata.tunnelvisionCanon;
    ctx.saveMetadata?.();
    return true;
}
