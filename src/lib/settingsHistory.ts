/**
 * Settings in the browser's history. The system Back button (Android's, a swipe from the screen's
 * edge) traverses history, and a dialog that is no entry of it is skipped: Back left the app
 * instead of the page. So each step into Settings is an entry above the app: the dialog, the
 * page a phone opens from its list, the key bar editor. Back takes them off one at a time.
 *
 * The dialog says what is shown as a list of levels (`recordSettings`); this module makes the
 * history hold exactly those entries, pushing the missing ones and stepping back over the ones
 * no longer shown (a Back control in the dialog, its X, Escape). It tells its listeners when a
 * traversal lands, and whether it was one of its own.
 */

const KEY = "herdr-web-ui:settings";
/** how long a traversal this module asked for may take to land before it is given up */
const LANDING_MS = 1000;

/** One step into Settings: the page shown (null: a phone's list of pages) and the key bar editor over it. */
export interface SettingsLevel {
  page: string | null;
  keyBar: boolean;
}

export interface SettingsEntry extends SettingsLevel {
  /** how many entries of Settings the history holds up to this one */
  depth: number;
}

/**
 * What the dialog shows, as the steps that led there. A phone lists the pages first, so its
 * list is a step of its own; a wider dialog opens on a page, and turning to another replaces it.
 */
export function settingsLevels(narrow: boolean, page: string | null, keyBar: boolean): SettingsLevel[] {
  const levels: SettingsLevel[] = narrow ? [{ page: null, keyBar: false }] : [];
  if (page !== null) levels.push({ page, keyBar: false });
  if (page !== null && keyBar) levels.push({ page, keyBar: true });
  return levels;
}

/** The Settings entry a history state holds, or null: state is whatever another script left there. */
export function settingsEntry(state: unknown): SettingsEntry | null {
  if (state === null || typeof state !== "object") return null;
  const entry = (state as Record<string, unknown>)[KEY];
  if (entry === null || typeof entry !== "object") return null;
  const { page, keyBar, depth } = entry as Record<string, unknown>;
  if ((page !== null && typeof page !== "string") || typeof keyBar !== "boolean") return null;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 3) return null;
  return { page, keyBar, depth };
}

type Listener = (entry: SettingsEntry | null, own: boolean) => void;
const listeners = new Set<Listener>();
let wanted: readonly SettingsLevel[] = [];
/** traversals asked for here that have not landed yet: nothing is pushed while one is under way */
let rewinding = 0;
let landing: ReturnType<typeof setTimeout> | undefined;

function rewind(by: number): void {
  rewinding += 1;
  clearTimeout(landing);
  // a traversal that never lands (the entries are gone) must not hold the history forever
  landing = setTimeout(() => { rewinding = 0; reconcile(); }, LANDING_MS);
  window.history.go(-by);
}

function reconcile(): void {
  if (rewinding > 0) return;
  const state: unknown = window.history.state;
  const have = settingsEntry(state)?.depth ?? 0;
  if (have > wanted.length) { rewind(have - wanted.length); return; }
  const base = state !== null && typeof state === "object" ? state : {};
  for (let depth = have + 1; depth <= wanted.length; depth++) window.history.pushState({ ...base, [KEY]: { ...wanted[depth - 1], depth } }, "");
  if (have === wanted.length && have > 0) {
    const current = settingsEntry(state)!;
    const level = wanted[have - 1]!;
    // a wider dialog turned its page: the same step, now showing something else
    if (current.page !== level.page || current.keyBar !== level.keyBar) window.history.replaceState({ ...base, [KEY]: { ...level, depth: have } }, "");
  }
}

/** Makes the history hold these steps into Settings, in order; none when the dialog is closed. */
export function recordSettings(levels: readonly SettingsLevel[]): void {
  wanted = levels;
  if (typeof window !== "undefined") reconcile();
}

/**
 * Tells when the history moved: the Settings entry it landed on (null: under the dialog), and
 * whether the move was this module's own stepping back, which the dialog already shows.
 */
export function onSettingsHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => {
    const own = rewinding > 0;
    if (own) {
      rewinding -= 1;
      if (rewinding === 0) clearTimeout(landing);
    }
    const entry = settingsEntry(event.state);
    for (const listener of [...listeners]) listener(entry, own);
    // what was asked for while the traversal was under way is done now
    if (own) reconcile();
  });
  // a reload keeps the history and not the dialog: step out of the entries it left
  const left = settingsEntry(window.history.state);
  if (left !== null) rewind(left.depth);
}
