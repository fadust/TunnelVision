// Install ownership before the upstream interface starts.
let active = false;
export const canonOwnershipActive = () => active;
export function enableCanonOwnership() { active = true; }
export const MEMORY_TOOLS = new Set([
    'TunnelVision_Remember', 'TunnelVision_Update', 'TunnelVision_Forget',
    'TunnelVision_Summarize', 'TunnelVision_Notebook',
]);
const MEMORY_SETTINGS = new Set([
    'notebookEnabled', 'autoSummaryEnabled', 'sidecarPostGenWriter',
    'postTurnEnabled', 'worldStateEnabled', 'lifecycleEnabled',
]);
export const OWNERSHIP_NOTICE = 'Disabled: BaiBai owns completed-event memory and NPC Codex owns actor state.';
const views = new WeakMap();
export function ownershipSettings(settings) {
    if (!active) return settings;
    if (!views.has(settings)) views.set(settings, new Proxy(settings, {
        get: (target, key) => MEMORY_SETTINGS.has(key) ? false : target[key],
        set: (target, key, value) => {
            if (!MEMORY_SETTINGS.has(key)) target[key] = value;
            return true;
        },
    }));
    return views.get(settings);
}
export function disabledTools(settings) {
    return { ...settings.disabledTools, ...Object.fromEntries(active ? [...MEMORY_TOOLS].map(name => [name, true]) : []) };
}
export function applyOwnershipUI() {
    if (!active) return;
    for (const id of ['tv_auto_summary_enabled', 'tv_sidecar_post_gen_writer', 'tv_world_state_enabled', 'tv_lifecycle_enabled', 'tv_post_turn_enabled', 'tv_ingest_chat']) {
        const control = document.getElementById(id);
        if (control) { control.disabled = true; if (control.type === 'checkbox') control.checked = false; control.title = OWNERSHIP_NOTICE; }
    }
    for (const control of document.querySelectorAll('.tv_tool_enabled, .tv_tool_confirm')) {
        if (MEMORY_TOOLS.has(control.dataset.tool)) { control.checked = false; control.disabled = true; control.title = OWNERSHIP_NOTICE; }
    }
}
