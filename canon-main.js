// This fork deliberately loads only canon retrieval. Upstream write/tool runtimes stay unloaded.
import { getState, saveState } from './canon/state/state-manager.js';
import { installCanonEvents, querySemanticCanon, semanticCanonStatus, semanticCanonRevision, prepareSemanticCanon } from './canon/context/semantic-canon.js';
import { mountCanonUI } from './canon/ui.js';

globalThis.TunnelVision = { ...globalThis.TunnelVision, bridge: {
    queryCanon: querySemanticCanon, canonStatus: semanticCanonStatus, canonRevision: semanticCanonRevision,
} };

let stopped = false;
globalThis.TunnelVision_generateInterceptor = async (chat, _size, abort, type) => {
    const ctx = globalThis.SillyTavern.getContext();
    const owner = ctx.getCurrentChatId?.() || ctx.chatId;
    stopped = false;
    await prepareSemanticCanon(chat, type);
    const latest = globalThis.SillyTavern.getContext();
    if (stopped || owner !== (latest.getCurrentChatId?.() || latest.chatId)) abort(true);
};

async function migrateContextIndex() {
    const ctx = globalThis.SillyTavern.getContext();
    // Snapshot an existing registry during migration; no Saga dependency after it is saved.
    const state = getState();
    if (!state.contextIndex && ctx.chatMetadata && globalThis.Saga?.bridge?.canonContextIndex) {
        try { state.contextIndex = await globalThis.Saga.bridge.canonContextIndex(); saveState(state); }
        catch (error) { console.warn('[TunnelVision canon] Context registry unavailable; bounded entries remain withheld', error); }
    }
}

async function init() {
    const ctx = globalThis.SillyTavern.getContext();
    await migrateContextIndex();
    const events = ctx.eventTypes || ctx.event_types || {};
    if (events.CHAT_CHANGED) ctx.eventSource.on(events.CHAT_CHANGED, migrateContextIndex);
    if (events.GENERATION_STOPPED) ctx.eventSource.on(events.GENERATION_STOPPED, () => { stopped = true; });
    installCanonEvents();
    mountCanonUI();
    document.dispatchEvent(new CustomEvent('tunnelvision:canon-owner'));
}

const ctx = globalThis.SillyTavern?.getContext?.();
const ready = (ctx?.eventTypes || ctx?.event_types || {}).APP_READY;
if (ready) ctx.eventSource.once(ready, init);
else void init();
