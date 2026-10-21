import { getState } from '../state/state-manager.js';
// Missing registry boundaries remain unresolved in the existing gate; never guess them.
export const getContextIndexSync = () => getState().contextIndex || null;
