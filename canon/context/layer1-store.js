const DATABASE = 'saga-layer1';

export function createCanonStore({ fetch: request, headers, embed }) {
    async function call(path, data, signal) {
        const response = await request(`/api/plugins/baibaoku/v1/${path}`, {
            method: 'POST', headers: headers(), body: JSON.stringify({ database: DATABASE, ...data }),
            signal: signal || AbortSignal.timeout(15000),
        });
        const json = await response.json();
        if (!response.ok || json.ok === false) throw new Error(`Canon storage: ${json.error?.message || response.status}`);
        return json.data || json;
    }
    async function get(store, key, signal) { return (await call('get', { store, key }, signal)).value ?? null; }
    async function set(store, key, value, signal) { return call('set', { store, key, value }, signal); }
    function vector64(vector) {
        if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite) || !vector.some(x => x !== 0)) throw new Error('Invalid canon embedding');
        const bytes = new Uint8Array(new Float32Array(vector).buffer);
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }
    async function index(view, model, signal) {
        const scope = `${model}:${view.revision}`;
        if ((await get('indexes', scope, signal))?.ready) return scope;
        let dimensions = 0;
        for (let offset = 0; offset < view.evidence.length; offset += 16) {
            const batch = view.evidence.slice(offset, offset + 16);
            const items = [], missing = [];
            for (const entry of batch) {
                const cached = await get('embeddings', `${model}:${entry.id}`, signal);
                if (cached) items.push({ leafId: entry.id, docHash: entry.id, vector: cached.vector, dim: cached.dim, document: entry.text });
                else missing.push(entry);
            }
            if (missing.length) {
                const vectors = await embed(missing.map(e => `title: ${e.title} | text: ${e.text}`), signal);
                if (!Array.isArray(vectors) || vectors.length !== missing.length) throw new Error('Incomplete canon embeddings');
                for (let i = 0; i < missing.length; i++) {
                    const entry = missing[i], vector = vector64(vectors[i]), dim = vectors[i].length;
                    await set('embeddings', `${model}:${entry.id}`, { vector, dim }, signal);
                    items.push({ leafId: entry.id, docHash: entry.id, vector, dim, document: entry.text });
                }
            }
            for (const item of items) {
                dimensions ||= item.dim;
                if (!Number.isInteger(item.dim) || item.dim !== dimensions) throw new Error('Inconsistent canon embedding dimensions');
            }
            await call('vec/upsert', { scope, items }, signal);
        }
        await set('indexes', scope, { ready: true, dimensions }, signal);
        return scope;
    }
    async function search(scope, query, signal) {
        const vectors = await embed([`task: search result | query: ${query}`], signal);
        if (!Array.isArray(vectors) || vectors.length !== 1) throw new Error('Invalid query embedding');
        const index = await get('indexes', scope, signal);
        if (!index?.ready || (index.dimensions && vectors[0].length !== index.dimensions)) throw new Error('Stale canon embedding index');
        const result = await call('vec/search', { scopes: [scope], queryVectors: [vector64(vectors[0])], topK: 30 }, signal);
        return (result.results || []).map(row => ({ id: row.leafId, score: row.similarity }));
    }
    return { get, set, index, search };
}
