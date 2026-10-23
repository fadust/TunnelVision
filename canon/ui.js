import { getSettings, getState, saveState } from './state/state-manager.js';
import { canonCardKey, semanticCanonStatus, invalidateCanon, analyzeCanonSources } from './context/semantic-canon.js';

export function mountCanonUI() {
    const container = document.querySelector('#tunnelvision_settings .tv-settings-body') || document.getElementById('extensions_settings2');
    if (!container || document.getElementById('tv-canon-panel')) return;
    const panel = document.createElement('details');
    panel.id = 'tv-canon-panel';
    panel.innerHTML = `<summary style="font-size:16px">Canon safeguards and NPC Codex</summary>
        <p>Search and automatic retrieval use validated canon evidence. BaiBai owns completed-event memory; NPC Codex owns actor state. Their overlapping writers are disabled; lorebook editing and tree organization remain available.</p>
        <label><input type="checkbox" data-enabled> Enable canon evidence</label>
        <p>Original lorebooks for the selected character:</p><select multiple size="5" data-books aria-label="Original canon lorebooks"></select>
        <button type="button" data-analyze>Analyze sources</button>
        <p role="status" data-status></p><details><summary>Evidence and review</summary><div data-evidence></div><div data-proposals></div></details>`;
    panel.style.cssText = 'font-size:14px; padding:10px; overflow-wrap:anywhere';
    panel.querySelector('select').style.cssText = 'width:100%;min-height:120px;font-size:14px';
    container.appendChild(panel);
    const host = () => globalThis.SillyTavern.getContext();
    const refresh = async () => { invalidateCanon(); document.dispatchEvent(new CustomEvent('tunnelvision:canon-owner')); await analyzeCanonSources(); await render(); };
    const saveSettings = async () => { const api = await import('../../../../../script.js'); api.saveSettingsDebounced(); };
    const ownSettings = () => { const ext = host().extensionSettings; ext.tunnelvision ||= {}; return ext.tunnelvision.canon ||= {}; };
    panel.querySelector('[data-enabled]').addEventListener('change', async event => {
        ownSettings().enabled = event.target.checked;
        ownSettings().semanticCanonEnabled = event.target.checked;
        await saveSettings(); await refresh();
    });
    panel.querySelector('[data-books]').addEventListener('change', async event => {
        if (!canonCardKey()) return;
        const settings = ownSettings();
        settings.layer1Sources = { ...getSettings().layer1Sources, [canonCardKey()]: [...event.target.selectedOptions].map(o => o.value) };
        await saveSettings(); await refresh();
        const { refreshUI } = await import('../ui-controller.js'); refreshUI();
    });
    panel.querySelector('[data-analyze]').addEventListener('click', refresh);
    function button(label, action) {
        const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
        element.addEventListener('click', action); return element;
    }
    async function render() {
        const status = semanticCanonStatus(), state = getState(), settings = getSettings();
        panel.querySelector('[data-enabled]').checked = settings.enabled && settings.semanticCanonEnabled;
        panel.querySelector('[data-status]').textContent = `${status.summary?.status || 'idle'} · ${status.evidence.length} evidence passages · scene selector: ${status.selector}. ${status.summary?.error || ''}`;
        const evidence = panel.querySelector('[data-evidence]'); evidence.replaceChildren();
        for (const entry of status.evidence) {
            const row = document.createElement('p'); row.textContent = `${entry.title}: ${entry.text} `;
            const muted = state.loreSelection?.suppressedIds?.includes(entry.id);
            row.append(button(muted ? 'Unmute' : 'Mute', async () => {
                state.loreSelection ||= {}; const ids = new Set(state.loreSelection.suppressedIds || []);
                if (muted) ids.delete(entry.id); else ids.add(entry.id);
                state.loreSelection.suppressedIds = [...ids]; saveState(state); await refresh();
            }), button(state.loreSelection?.elevated?.[entry.id] ? 'Unelevate' : 'Elevate', async () => {
                state.loreSelection ||= {}; state.loreSelection.elevated ||= {};
                if (state.loreSelection.elevated[entry.id]) delete state.loreSelection.elevated[entry.id];
                else state.loreSelection.elevated[entry.id] = { elevatedAt: Date.now() };
                saveState(state); await refresh();
            })); evidence.appendChild(row);
        }
        const proposals = panel.querySelector('[data-proposals]'); proposals.replaceChildren();
        for (const entry of state.pendingLoreEntries || []) {
            if (!entry.extensions?.layer1 || entry.extensions.layer1.revision !== status.summary?.revision) continue;
            const row = document.createElement('p'); row.textContent = `Unproven interpretation for review: ${entry.content?.fact || ''} `;
            const decide = async accept => {
                if (semanticCanonStatus().summary?.revision !== entry.extensions.layer1.revision) return;
                state.pendingLoreEntries = state.pendingLoreEntries.filter(e => e.id !== entry.id);
                state.layer1Decisions ||= {}; state.layer1Decisions[entry.id] = accept ? 'accepted' : 'rejected';
                if (accept) { state.loreMatrix ||= []; if (!state.loreMatrix.some(e => e.id === entry.id)) state.loreMatrix.push(entry); }
                saveState(state); await refresh();
            };
            row.append(button('Accept interpretation', () => decide(true)), button('Reject', () => decide(false)));
            proposals.appendChild(row);
        }
        const api = await import('../../../../world-info.js');
        const books = panel.querySelector('[data-books]'); books.replaceChildren();
        const selected = settings.layer1Sources?.[canonCardKey()] || [];
        for (const name of [...new Set([...(api.world_names || []), ...selected])]) {
            const option = document.createElement('option'); option.value = name; option.textContent = name; option.selected = selected.includes(name); books.appendChild(option);
        }
        books.disabled = !canonCardKey();
    }
    document.addEventListener('tunnelvision:canon-analysis', () => { void render(); });
    const events = host().eventTypes || host().event_types || {};
    if (events.CHAT_CHANGED) host().eventSource.on(events.CHAT_CHANGED, () => { void render(); });
    void render();
}
