// Keep the upstream interface; story retrieval still passes the canon gate.
import { enableCanonOwnership } from './canon/ownership.js';
import { getState, saveState } from './canon/state/state-manager.js';
import { installCanonEvents, querySemanticCanon, semanticCanonStatus, semanticCanonRevision, prepareSemanticCanon } from './canon/context/semantic-canon.js';
import { mountCanonUI } from './canon/ui.js';

enableCanonOwnership();

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
    // Retain the deployed selector default when introducing the upstream controls.
    ctx.extensionSettings.tunnelvision ||= {};
    ctx.extensionSettings.tunnelvision.sidecarAutoRetrieval ??= true;
    await import('./index.js');
    installCanonEvents();
    mountCanonUI();
    document.addEventListener('tunnelvision:canon-analysis', async () => {
        const { registerTools } = await import('./tool-registry.js');
        if (getState().layer1Analysis?.status !== 'analyzing') await registerTools();
    });
    document.dispatchEvent(new CustomEvent('tunnelvision:canon-owner'));
}

const ctx = globalThis.SillyTavern?.getContext?.();
const ready = (ctx?.eventTypes || ctx?.event_types || {}).APP_READY;
if (ready) ctx.eventSource.once(ready, init);
else void init();
