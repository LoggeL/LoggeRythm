/**
 * Bookkeeping for the motion between pages.
 *
 * Shared elements ("morphs"): a card that links to a detail page and that
 * page's hero show the same thing, so the artwork and title travel from one to
 * the other. React pairs two `<ViewTransition>`s by name, and a name may be
 * mounted only once per page. Every card therefore has its own fixed name
 * (the page it opens plus the list it sits in), and the hero takes over the
 * name of the one card it was opened from. That card is recorded here as the
 * "ticket", together with what it showed (`seed`), so the detail page can draw
 * its artwork and title before its own data has loaded.
 *
 * History traversals: Back/Forward cannot run as a view transition, so the
 * page reached that way is remembered and fades in on its own.
 *
 * This module is framework-free; `components/motion/Morph.tsx` binds it to React.
 */

export type MorphPart = "art" | "title";

/** What the source card showed; enough to draw the destination's hero. */
export interface MorphSeed {
  title: string;
  cover?: string | null;
}

interface MorphTicket {
  /** Identity of the detail page, see `morphKey`. */
  key: string;
  /** Pathname of the page the source card is on. */
  from: string;
  /** List the source card is in; tells apart the same entity in two lists. */
  scope: string;
  seed: MorphSeed;
  /** The detail page has been shown; a hero mounted from here on stays put. */
  landed: boolean;
}

let ticket: MorphTicket | null = null;
/** Page the visitor is on, as of the last `settleMorph`. */
let settledPath: string | null = null;
/** Page reached through the browser history (Back/Forward), until the next navigation. */
let traversedTo: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Identity of a detail page: its path without query, hash and trailing slash. */
export function morphKey(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * `view-transition-name` of the card in list `scope` that opens `path`. It is
 * unique on a page as long as a list shows each entity once (lists are keyed
 * by entity) and each list has its own `scope`.
 */
export function morphName(part: MorphPart, path: string, scope: string): string {
  const identity = `${morphKey(path)}@${scope}`;
  return `morph-${part}${identity.replace(/[^A-Za-z0-9-]/g, (char) => `_${char.codePointAt(0)!.toString(36)}`)}`;
}

export function subscribeMorph(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The visitor opened `href` from the card in list `scope` on page `from`. */
export function armMorph(href: string, scope: string, from: string, seed: MorphSeed): void {
  ticket = { key: morphKey(href), from: morphKey(from), scope, seed, landed: false };
  emit();
}

/**
 * Name for the hero of page `pathname` while that page is being opened from a
 * card: the name of that card. `null` once the page has been shown (or when it
 * was not opened from a card), so a hero mounted later, e.g. when the page's
 * data arrives, is an ordinary part of the page and does not pair with the
 * placeholder it replaces.
 */
export function morphTargetName(part: MorphPart, pathname: string): string | null {
  if (ticket === null || ticket.landed || ticket.key !== morphKey(pathname)) return null;
  return morphName(part, ticket.key, ticket.scope);
}

/** What the source card showed, while `pathname` is the page the ticket leads to. */
export function morphSeedFor(pathname: string): MorphSeed | null {
  return ticket !== null && ticket.key === morphKey(pathname) ? ticket.seed : null;
}

/**
 * Call after every navigation. The ticket lives on the page it leads to and on
 * the page it was issued on (a navigation may still be on its way from there)
 * and is dropped once the visitor is anywhere else.
 */
export function settleMorph(pathname: string): void {
  const here = morphKey(pathname);
  settledPath = here;
  let changed = false;
  if (traversedTo !== null && traversedTo !== here) {
    traversedTo = null;
    changed = true;
  }
  if (ticket !== null && here === ticket.key && !ticket.landed) {
    ticket = { ...ticket, landed: true };
    changed = true;
  } else if (ticket !== null && here !== ticket.key && here !== ticket.from) {
    ticket = null;
    changed = true;
  }
  if (changed) emit();
}

/**
 * The browser history is about to move to `pathname` (Back/Forward). React
 * commits such a navigation synchronously and without a view transition, so
 * the page that appears is marked to fade in on its own instead.
 */
export function noteTraversal(pathname: string): void {
  const target = morphKey(pathname);
  // Same page, other query (search and library tabs): nothing is replaced.
  if (target === settledPath) return;
  traversedTo = target;
  emit();
}

/** Whether `pathname` was reached through the browser history rather than a link. */
export function isTraversal(pathname: string): boolean {
  return traversedTo === morphKey(pathname);
}
