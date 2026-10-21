/**
 * lore-response-normalizer.js -- Saga
 * Shared helpers for extracting visible model output from provider-shaped responses.
 */

export const LORE_RESPONSE_ERROR_CODES = Object.freeze({
    EMPTY_CONTENT: 'provider_empty_content',
    REASONING_ONLY: 'provider_reasoning_only',
    TOKEN_LIMIT: 'provider_token_limit',
});

export const LORE_PARSE_ERROR_CODES = Object.freeze({
    JSON_INVALID: 'json_invalid',
});

function cleanProviderTitle(value = '') {
    return String(value || '').trim() || 'Provider';
}

function cleanErrorText(value = '', maxLength = 1000) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength).trim();
}

export function extractLoreContentText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(part => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object') return '';
            if (part.type === 'text' && typeof part.text === 'string') return part.text;
            if (typeof part.text === 'string') return part.text;
            if (typeof part.content === 'string') return part.content;
            if (Array.isArray(part.content)) return extractLoreContentText(part.content);
            if (typeof part.value === 'string') return part.value;
            return '';
        }).filter(Boolean).join('');
    }
    if (value && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.content === 'string') return value.content;
        if (Array.isArray(value.content)) return extractLoreContentText(value.content);
        if (typeof value.value === 'string') return value.value;
    }
    return '';
}

function hasSagaJsonResponseShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return [
        'summary',
        'clarifyingQuestions',
        'questions',
        'warnings',
        'proposals',
        'changes',
        'brief',
        'packBrief',
        'outline',
        'storyOutline',
        'titleDrafts',
        'titles',
        'entries',
        'batch',
        'titleBatch',
        'delta',
    ].some(key => Object.prototype.hasOwnProperty.call(value, key));
}

export function extractLoreResponseText(value = '') {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return String(value || '');
    const text = extractLoreContentText(value?.choices?.[0]?.message?.content)
        || extractLoreContentText(value?.choices?.[0]?.delta?.content)
        || extractLoreContentText(value?.choices?.[0]?.text)
        || extractLoreContentText(value?.message?.content)
        || extractLoreContentText(value?.content)
        || extractLoreContentText(value?.response)
        || extractLoreContentText(value?.text);
    if (text) return text;
    if (hasSagaJsonResponseShape(value)) {
        try { return JSON.stringify(value); } catch (_) {}
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        return String(value || '');
    }
    return '';
}

export function extractLoreResponseReasoning(value = '') {
    if (!value || typeof value !== 'object') return '';
    const message = value?.choices?.[0]?.message || value?.message || value || {};
    const parts = [];
    const direct = [
        message.reasoning,
        message.reasoning_content,
        message.reasoningContent,
        value?.choices?.[0]?.reasoning,
        value?.reasoning,
    ];
    for (const item of direct) {
        const text = extractLoreContentText(item);
        if (text) parts.push(text);
    }
    const details = message.reasoning_details || value?.choices?.[0]?.message?.reasoning_details || value?.reasoning_details;
    if (Array.isArray(details)) {
        for (const detail of details) {
            if (typeof detail?.text === 'string') parts.push(detail.text);
            else if (typeof detail?.content === 'string') parts.push(detail.content);
        }
    }
    return parts.join('').slice(0, 12000);
}

export function normalizeLoreResponseFinishReason(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'object') {
        return normalizeLoreResponseFinishReason(
            value.reason
            ?? value.type
            ?? value.code
            ?? value.status
            ?? value.finish_reason
            ?? value.finishReason
            ?? value.stop_reason
            ?? value.stopReason
            ?? value.native_finish_reason
            ?? value.nativeFinishReason
        );
    }
    return String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function collectLoreResponseFinishReasons(value) {
    if (!value || typeof value !== 'object') return [];
    const choice = Array.isArray(value.choices) ? value.choices[0] : null;
    const message = choice?.message || value.message || {};
    const candidate = Array.isArray(value.candidates) ? value.candidates[0] : null;
    const output = Array.isArray(value.outputs) ? value.outputs[0] : Array.isArray(value.output) ? value.output[0] : null;
    const details = choice?.finish_details || choice?.finishDetails || value.finish_details || value.finishDetails;
    const metadata = value.response_metadata || value.responseMetadata || value.metadata || {};
    return [
        choice?.finish_reason,
        choice?.finishReason,
        choice?.native_finish_reason,
        choice?.nativeFinishReason,
        choice?.stop_reason,
        choice?.stopReason,
        message?.finish_reason,
        message?.finishReason,
        message?.stop_reason,
        message?.stopReason,
        value.finish_reason,
        value.finishReason,
        value.native_finish_reason,
        value.nativeFinishReason,
        value.stop_reason,
        value.stopReason,
        details,
        metadata?.finish_reason,
        metadata?.finishReason,
        metadata?.stop_reason,
        metadata?.stopReason,
        candidate?.finish_reason,
        candidate?.finishReason,
        candidate?.stop_reason,
        candidate?.stopReason,
        output?.finish_reason,
        output?.finishReason,
        output?.stop_reason,
        output?.stopReason,
    ].map(normalizeLoreResponseFinishReason).filter(Boolean);
}

export function isLoreResponseTokenLimitFinishReason(reason) {
    const normalized = normalizeLoreResponseFinishReason(reason);
    if (!normalized) return false;
    if (['length', 'max_tokens', 'max_token', 'max_completion_tokens', 'max_output_tokens', 'token_limit', 'token_limit_reached', 'length_limit', 'truncated', 'incomplete'].includes(normalized)) return true;
    return normalized.includes('max_token')
        || normalized.includes('token_limit')
        || normalized.includes('length_limit')
        || normalized.includes('output_limit');
}

export function describeLoreResponse(value = '', options = {}) {
    const text = extractLoreResponseText(value);
    const reasoning = extractLoreResponseReasoning(value);
    const finishReasons = collectLoreResponseFinishReasons(value);
    const sampleLimit = Math.max(0, Math.min(1000, Number(options.sampleLimit ?? 160) || 160));
    return {
        resultType: value === null ? 'null' : (Array.isArray(value) ? 'array' : typeof value),
        finishReason: finishReasons[0] || '',
        visibleContentLength: text.length,
        reasoningLength: reasoning.length,
        sample: sampleLimit ? text.slice(0, sampleLimit) : '',
    };
}

export function getLoreResponseFailure(value = '', options = {}) {
    const providerTitle = cleanProviderTitle(options.providerTitle || options.title || options.provider || '');
    const description = describeLoreResponse(value, { sampleLimit: options.sampleLimit ?? 160 });
    const tokenReason = collectLoreResponseFinishReasons(value).find(isLoreResponseTokenLimitFinishReason) || '';
    if (tokenReason) {
        const maxTokens = Math.max(1, Number(options.maxTokens || 0) || 0);
        return {
            ...description,
            code: LORE_RESPONSE_ERROR_CODES.TOKEN_LIMIT,
            providerTitle,
            finishReason: tokenReason,
            maxTokens,
            message: maxTokens
                ? `${providerTitle} provider stopped because it hit the response token limit (${tokenReason}; max ${maxTokens}). Increase ${providerTitle} Max Tokens, reduce source messages/chunk size, or use a model/provider with a larger output limit.`
                : `${providerTitle} provider stopped because it hit the response token limit (${tokenReason}). Increase max tokens, reduce source messages/chunk size, or use a model/provider with a larger output limit.`,
        };
    }

    const visibleText = extractLoreResponseText(value);
    if (visibleText.trim()) return null;

    const reasoning = extractLoreResponseReasoning(value);
    if (reasoning.trim()) {
        const retried = options.retried === true;
        const retryText = retried
            ? ' Retried with final-only visible-output instructions but still received no visible content.'
            : '';
        return {
            ...description,
            code: LORE_RESPONSE_ERROR_CODES.REASONING_ONLY,
            providerTitle,
            reasoningPreview: reasoning.slice(0, 300),
            message: `${providerTitle} provider returned reasoning-only output with empty visible content.${retryText} Increase max tokens, reduce reasoning effort, or use a non-thinking model. Reasoning preview: ${reasoning.slice(0, 300)}`,
        };
    }

    return {
        ...description,
        code: LORE_RESPONSE_ERROR_CODES.EMPTY_CONTENT,
        providerTitle,
        message: `${providerTitle} provider returned empty content.`,
    };
}

export function createLoreResponseError(failureOrCode, message = '', details = {}) {
    const failure = failureOrCode && typeof failureOrCode === 'object' && !Array.isArray(failureOrCode)
        ? failureOrCode
        : { code: failureOrCode, message, ...details };
    const error = new Error(cleanErrorText(failure.message || message || failure.code || 'Provider response was not usable.', 1400));
    error.name = 'LoreResponseError';
    error.code = cleanErrorText(failure.code || '', 120);
    error.details = { ...failure };
    return error;
}

export function createLoreJsonInvalidDiagnostic(message = 'Model response was not valid JSON.', details = {}) {
    return {
        ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {}),
        code: LORE_PARSE_ERROR_CODES.JSON_INVALID,
        message: cleanErrorText(message || 'Model response was not valid JSON.', 1000),
    };
}

export function annotateLoreJsonInvalidError(error, message = 'Model response was not valid JSON.', details = {}) {
    if (error && typeof error === 'object') {
        if (!error.code && !error.errorCode) {
            try { error.code = LORE_PARSE_ERROR_CODES.JSON_INVALID; } catch (_) {}
        }
        if (!error.details && details && typeof details === 'object' && !Array.isArray(details) && Object.keys(details).length) {
            try { error.details = createLoreJsonInvalidDiagnostic(error.message || message, details); } catch (_) {}
        }
        return error;
    }
    const diagnostic = createLoreJsonInvalidDiagnostic(message, details);
    const wrapped = new Error(diagnostic.message);
    wrapped.name = 'LoreJsonParseError';
    wrapped.code = diagnostic.code;
    wrapped.details = diagnostic;
    return wrapped;
}

export function assertLoreResponseText(value = '', options = {}) {
    const failure = getLoreResponseFailure(value, options);
    if (failure) throw createLoreResponseError(failure);
    return extractLoreResponseText(value);
}
