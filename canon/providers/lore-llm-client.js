import { assertLoreResponseText } from './lore-response-normalizer.js';

export async function sendLoreRequest(system, prompt, options = {}) {
    options.signal?.throwIfAborted();
    const settings = globalThis.SillyTavern?.getContext?.()?.extensionSettings?.tunnelvision;
    if (settings?.sidecarProfile?.enabled) {
        const { sidecarGenerate } = await import('../../llm-sidecar.js');
        options.onRequest?.();
        const text = await sidecarGenerate({ systemPrompt: [system, settings.backgroundPromptAddendum, settings.targetLanguage && `Respond in ${settings.targetLanguage}.`].filter(Boolean).join('\n'), prompt, signal: options.signal, maxTokens: options.maxTokens });
        options.signal?.throwIfAborted();
        if (typeof text !== 'string' || text.length > 262144 || !text.trim()) throw new Error('Invalid canon provider response');
        return text;
    }
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
