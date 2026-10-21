import { assertLoreResponseText } from './lore-response-normalizer.js';

export async function sendLoreRequest(system, prompt, options = {}) {
    options.signal?.throwIfAborted();
    const service = globalThis.SillyTavern?.getContext?.()?.ConnectionManagerRequestService;
    if (!options.profileId || !service?.sendRequest) throw new Error('Select an NPC Codex scanner connection profile first');
    options.onRequest?.();
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(options.signal.reason);
        options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    let response;
    try { response = await Promise.race([aborted, service.sendRequest(options.profileId,
        [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        Math.max(128, Math.min(8192, options.maxTokens || 8192)),
        { signal: options.signal, stream: false, extractData: true, includePreset: true, includeInstruct: true })]); }
    finally { options.signal?.removeEventListener('abort', onAbort); }
    options.signal?.throwIfAborted();
    if (JSON.stringify(response)?.length > 262144) throw new Error('Canon provider response exceeds 256 KiB');
    options.onUsage?.(response?.usage);
    return assertLoreResponseText(response);
}
