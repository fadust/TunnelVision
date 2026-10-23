import { getSettings, getTree } from '../tree-store.js';
import { canonToolPreview, canonToolView, retrieveCanonTool } from './context/semantic-canon.js';

// Keep the user's organization, but never publish raw entry text or generated summaries.
export function filteredTree(evidence, books, settings) {
    const assigned = new Set();
    function visit(node, book) {
        if (!node) return null;
        const entries = evidence.filter(e => e.basis.some(b => (node.entryUids || []).some(uid => b.source === `book:${book}:${uid}`)));
        entries.forEach(e => assigned.add(e.id));
        const children = (node.children || []).map(n => visit(n, book)).filter(Boolean);
        return entries.length || children.length ? { id: node.id, label: node.label, entries, children } : null;
    }
    const roots = books.map(book => {
        const root = visit(settings.trees?.[book]?.root, book);
        return root && { ...root, label: book };
    }).filter(Boolean);
    const remaining = evidence.filter(e => !assigned.has(e.id));
    for (const type of new Set(remaining.map(e => e.entityType || 'other'))) {
        roots.push({ id: `canon:${type}`, label: type, children: [], entries: remaining.filter(e => (e.entityType || 'other') === type) });
    }
    return roots;
}
function treeFor(view) {
    const settings = getSettings();
    const books = [...new Set(view.evidence.map(e => e.world).filter(book => book !== 'card' && book !== 'interpretation'))];
    const roots = filteredTree(view.evidence, books, { trees: Object.fromEntries(books.map(book => [book, getTree(book)])) });
    if (settings.multiBookMode !== 'unified' || books.length < 2) return roots;
    const groups = new Map();
    for (const root of roots) for (const node of root.children) {
        const key = node.label.toLowerCase();
        if (!groups.has(key)) groups.set(key, { id: `canon:unified:${groups.size}`, label: node.label, entries: [], children: [] });
        groups.get(key).children.push(node);
    }
    return [...groups.values(), ...roots.filter(root => root.entries.length)];
}
export function canonSelectionTree(evidence) {
    const encode = nodes => nodes.map(n => ({ id: n.id, label: n.label, entries: n.entries.map(e => ({ id: e.id, text: e.text })), children: encode(n.children) }));
    return encode(treeFor({ evidence }));
}
function manifest(entries) {
    return entries.map(e => ({ evidence_id: e.id, title: e.title, lorebook: e.world, uid: e.uid }));
}
function overview(nodes, depth) {
    return nodes.map(n => ({ id: n.id, label: n.label, entries: manifest(n.entries),
        ...(n.children.length ? { children: depth > 1 ? overview(n.children, depth - 1) : n.children.map(c => ({ id: c.id, label: c.label })) } : {}) }));
}
export function getCanonTreeOverview() {
    const settings = getSettings();
    return '\n\nValidated canon tree:\n' + JSON.stringify(overview(treeFor(canonToolPreview()), settings.searchMode === 'collapsed' ? settings.collapsedDepth ?? 2 : 1));
}
export function getCanonSearchDefinition() {
    return {
        name: 'TunnelVision_Search', displayName: 'TunnelVision Search',
        description: 'Navigate or retrieve the validated canon tree. Use node_id/node_ids, action search with query, or evidence_ids from a manifest. Source versions, context, native eligibility and the shared canon budget always apply. Unavailable is not no-match.',
        parameters: { type: 'object', properties: {
            action: { type: 'string', enum: ['navigate', 'retrieve', 'search'] },
            node_id: { type: 'string' }, node_ids: { type: 'array', items: { type: 'string' } },
            evidence_ids: { type: 'array', items: { type: 'string' } },
            entry_uids: { type: 'array', items: { type: 'number' } }, query: { type: 'string' },
        } },
        action: async (args = {}) => {
            const view = await canonToolView();
            if (!view) return 'Canon evidence unavailable. Analyze the selected sources; no raw fallback is used.';
            const roots = treeFor(view), nodes = [];
            const flatten = list => { for (const node of list) { nodes.push(node); flatten(node.children); } };
            flatten(roots);
            const ids = args.node_ids || (args.node_id ? [args.node_id] : []);
            const picked = nodes.filter(n => ids.includes(n.id));
            if (ids.some(id => !nodes.some(n => n.id === id))) return 'Unknown or stale node ID. Navigate the current tree again.';
            const collect = node => [...node.entries, ...node.children.flatMap(collect)];
            let entries = picked.length ? picked.flatMap(collect) : view.evidence;
            if (args.action === 'search') {
                const query = String(args.query || '').trim().toLowerCase();
                if (!query) return 'Provide a search query.';
                entries = entries.filter(e => `${e.title} ${e.aliases?.join(' ')} ${e.text}`.toLowerCase().includes(query));
            }
            if (Array.isArray(args.entry_uids) && args.entry_uids.length) {
                const matches = view.evidence.filter(e => args.entry_uids.includes(e.uid));
                for (const uid of args.entry_uids) if (new Set(matches.filter(e => e.uid === uid).map(e => e.world)).size > 1) return 'UID is ambiguous across books. Use the qualified evidence_ids in the manifest.';
                entries = entries.filter(e => args.entry_uids.includes(e.uid));
            }
            if (args.evidence_ids?.some(id => !view.evidence.some(e => e.id === id))) return 'Unknown or stale evidence ID.';
            if (args.evidence_ids?.length) entries = entries.filter(e => args.evidence_ids.includes(e.id));
            if (args.action === 'navigate' || (!args.action && getSettings().searchMode !== 'collapsed' && picked.some(n => n.children.length))) {
                return JSON.stringify({ revision: view.revision, tree: overview(picked.length ? picked : roots, 2) });
            }
            if (!ids.length && !args.evidence_ids?.length && !args.entry_uids?.length && args.action !== 'search') {
                return JSON.stringify({ revision: view.revision, tree: overview(roots, 1) });
            }
            if (getSettings().selectiveRetrieval && !args.evidence_ids?.length && !args.entry_uids?.length) {
                return JSON.stringify({ revision: view.revision, entries: manifest(entries), next: 'Retrieve the required evidence_ids.' });
            }
            return retrieveCanonTool(view.revision, [...new Set(entries.map(e => e.id))]);
        },
        formatMessage: async args => args?.action === 'navigate' ? 'Navigating canon tree...' : 'Searching validated canon...',
        shouldRegister: async () => getSettings().globalEnabled !== false,
        stealth: false,
    };
}
