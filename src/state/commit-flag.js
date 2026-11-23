import { loadState, saveState } from './store.js';

/**
 * Tells the notify step (cause `commit-conflicto`, DRT 11 step 11) whether the
 * history commit was pushed, through `ops.commitConflict` in the run state.
 * Best effort and isolated: a state that cannot be read or written is logged
 * (only the error name) and never changes the outcome of the commit step.
 * A rebuilt state is left alone: with no run before it there is nothing to flag.
 *
 * @param {{ unpushed: boolean, statePath?: string, load?: typeof loadState, save?: typeof saveState, log?: (line: string) => void }} input
 * @returns {boolean} true when the flag was recorded
 */
export function recordCommitConflict({ unpushed, statePath, load = loadState, save = saveState, log = console.log }) {
  try {
    const loaded = statePath === undefined ? load() : load(statePath);
    if (loaded.rebuilt) return false;
    const next = { ...loaded.state, ops: { ...loaded.state.ops, commitConflict: unpushed } };
    if (statePath === undefined) save(next);
    else save(next, statePath);
    return true;
  } catch (error) {
    // No message and no stack: they could carry paths or content.
    log(`::warning::cuotear: commit: the commit outcome could not be recorded in the run state (${error instanceof Error ? error.name : 'Error'})`);
    return false;
  }
}
