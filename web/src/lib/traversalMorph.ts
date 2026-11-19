/**
 * Back/Forward as a view transition: the page area slides (Back to the
 * left-hand page, Forward to the right-hand one) and, when the history moves
 * between a detail page and the list it was opened from, the artwork, the
 * title and the metadata line travel between the card and the hero (the
 * reverse of the link morph in `components/motion/Morph.tsx`).
 *
 * Why this needs its own mechanism: React renders a `popstate` navigation
 * synchronously, and a synchronous render never runs as a `<ViewTransition>`.
 * The browser, in turn, can only animate a change that happens inside
 * `document.startViewTransition`. So the traversal is held back for the one
 * frame the browser needs to capture the old page:
 *
 *   1. A capture-phase `popstate` listener on `window` runs before the app
 *      router's listener (and the search provider's) and stops the event.
 *   2. It names the page area and, if this traversal has one, the old half of
 *      the pair, then calls `document.startViewTransition`.
 *   3. In the update callback an equivalent `PopStateEvent` (same `state`) is
 *      dispatched; everything that listens for `popstate` sees it exactly as
 *      it would have seen the original, in the same order and with the same
 *      `location`. While it is delivered `window.event` reports that event, so
 *      React still treats the render as a `popstate` render and commits the
 *      destination synchronously, in one pass with the search provider's own
 *      update. Then the new half of the pair is named and the browser animates.
 *
 * Step 3 has to be synchronous and reach all listeners together because of
 * the search provider (`hooks/useSearchNavigation.tsx`): on `popstate` it
 * copies the query from `location` into its own state, and an effect then
 * reconciles that state with the router's. If the router's state lags behind
 * (it renders later, or only one of the two sees the event), the effect
 * "corrects" the URL with `router.push` or `history.replaceState`, and the
 * history gains an entry or loses the URL of the one just reached.
 *
 * Names are not React's: elements get a `data-traverse` attribute, and
 * globals.css ("Back/Forward") turns it into the fixed names `traverse-page`,
 * `traverse-art`, `traverse-title` and `traverse-meta` with the classes of the link morph, so
 * both directions share durations, easing and keyframes. React's names are
 * inline styles derived from `morphName()` ("morph-…") and win over these
 * rules, so the two can neither collide nor clear each other. `<html
 * data-traversing>` takes the root out of the transition: the shell is not
 * captured and stays live (`data-traversing="fade"`: the pair's other half is
 * not on screen, so the captured half fades with its page). `<html
 * data-traverse-direction>` ("back" / "forward") picks the page's slide.
 *
 * Whenever the traversal cannot or should not be animated (`judgeTraversal`),
 * the original event is left alone and the navigation runs as it always did,
 * with the `page-return` fade. A traversal is never dropped: a failure on this
 * path is reported with `console.error` and the event still reaches the router.
 *
 * Internals this depends on (check them when upgrading Next or React):
 * - `next/dist/client/components/app-router.js`: the router handles a
 *   traversal in a plain `window` `popstate` listener that reads only
 *   `event.state` and `window.location`. A re-dispatched event is therefore
 *   processed like the native one.
 * - `react-dom` (`shouldAttemptEagerTransition`): a transition started during
 *   `popstate` is rendered synchronously if `window.event.type === "popstate"`
 *   when React's scheduler microtask runs. A dispatched event is no longer
 *   `window.event` by then, hence the temporary `window.event` getter.
 * - `document.__reactViewTransition` is read (never written) to stay out of
 *   the way of a transition React is running.
 * If one of the first two changes, the destination is no longer on screen
 * when the update callback continues. That is detected (`renderedPath`),
 * reported once with `console.error`, and the module switches itself off for
 * the rest of the page load; from then on every traversal runs as it did
 * before this module existed.
 *
 * To remove: delete this file and `tests/traversal-morph.test.mjs`, the
 * "Back/Forward" rules in globals.css, `useTraversalMorph` (and its call in
 * the shell), `tagged` and the `noteCardClick` call in
 * `components/motion/Morph.tsx`, the `data-traverse-card` prop of `Cover` and
 * `CoverPlaceholder`, `data-traverse-page` in the shell and `forgetTraversal`
 * in `lib/morph.ts`.
 */

import { forgetTraversal, morphKey, morphName, noteTraversal, type MorphPart } from "@/lib/morph";

// ---- Which card opened which history entry ---------------------------------

/** A card, by the page it opens and the list it sits in (see `morphName`). */
export interface CardRef {
  path: string;
  scope: string;
}

/** One side of a traversal: the history entry's key and the page it shows. */
export interface EntryRef {
  key: string;
  path: string;
}

interface Opening {
  /** Key of the history entry the card is on. */
  from: string;
  card: CardRef;
}

/** Entries are small; the cap only bounds a very long session. */
const MAX_OPENINGS = 200;
/** By the key of the history entry that the card's click created. */
const openings = new Map<string, Opening>();
/** A clicked card whose navigation has not created its history entry yet. */
let pendingOpening: Opening | null = null;

/** The visitor clicked the card in list `scope` that opens `href`, while on history entry `entry`. */
export function armOpening(entry: string, href: string, scope: string): void {
  pendingOpening = { from: entry, card: { path: morphKey(href), scope } };
}

/**
 * The history went from entry `from` to entry `to`, which shows `path`
 * (`type` as in the Navigation API). A new entry for the page of the card
 * that was just clicked belongs to that card.
 */
export function noteEntryChange(type: string | null, from: string, to: string, path: string): void {
  // The entry stays the same one (the search writing its query into the URL).
  if (type === "replace") return;
  const opening = pendingOpening;
  pendingOpening = null;
  if (type !== "push" || opening === null || opening.from !== from || opening.card.path !== morphKey(path)) return;
  openings.delete(to);
  openings.set(to, opening);
  if (openings.size > MAX_OPENINGS) openings.delete(openings.keys().next().value!);
}

/**
 * The shared elements of a traversal from `left` to `arrived`: the card, and
 * which side shows the hero. `null` when neither entry was opened from a card
 * on the other one (also after a reload, when nothing is known any more).
 */
export function traversalPair(left: EntryRef, arrived: EntryRef): { card: CardRef; hero: "old" | "new" } | null {
  const back = openings.get(left.key);
  if (back !== undefined && back.from === arrived.key && back.card.path === morphKey(left.path)) return { card: back.card, hero: "old" };
  const forward = openings.get(arrived.key);
  if (forward !== undefined && forward.from === left.key && forward.card.path === morphKey(arrived.path)) return { card: forward.card, hero: "new" };
  return null;
}

// ---- Whether to animate a traversal ----------------------------------------

export interface TraversalFacts {
  /** View transitions and every feature this module leans on exist. */
  supported: boolean;
  reducedMotion: boolean;
  /** The browser has animated the traversal itself (a swipe gesture). */
  uaTransition: boolean;
  /** The history entry was written by the app router. */
  routerEntry: boolean;
  documentVisible: boolean;
  /** Some view transition (React's or another) is on screen. */
  transitionRunning: boolean;
  /** The page area is there and nothing lies over it. */
  pageAreaFree: boolean;
  /** Page shown now and page the history moved to. */
  from: string;
  to: string;
}

export type TraversalVerdict =
  | "animate"
  | "unsupported"
  | "reduced-motion"
  | "ua-transition"
  | "foreign-entry"
  | "hidden"
  | "busy"
  | "no-page-area"
  | "same-page";

/** `"animate"`, or the reason the traversal is left to run as it always did. */
export function judgeTraversal(facts: TraversalFacts): TraversalVerdict {
  if (!facts.supported) return "unsupported";
  if (facts.reducedMotion) return "reduced-motion";
  if (facts.uaTransition) return "ua-transition";
  if (!facts.routerEntry) return "foreign-entry";
  if (!facts.documentVisible) return "hidden";
  if (facts.transitionRunning) return "busy";
  if (!facts.pageAreaFree) return "no-page-area";
  // Same page, other query (search and library tabs): nothing is replaced.
  if (morphKey(facts.from) === morphKey(facts.to)) return "same-page";
  return "animate";
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How much of `box` (0…1) is left after clipping it to every box in `clips`. */
export function visibleFraction(box: Box, clips: Box[]): number {
  const area = (box.right - box.left) * (box.bottom - box.top);
  if (!(area > 0)) return 0;
  let { left, top, right, bottom } = box;
  for (const clip of clips) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  return right > left && bottom > top ? ((right - left) * (bottom - top)) / area : 0;
}

/** An element travels only if (nearly) all of it is on screen; nothing flies in from outside. */
const MIN_VISIBLE = 0.9;

// ---- Whether React rendered the traversal -----------------------------------

let renderedPath: string | null = null;

/**
 * Called while the shell renders, with the path it renders. Tells a
 * destination that React rendered at once but could not show yet (it waits for
 * data) from one React did not render at once at all (the mechanism broke).
 */
export function noteRenderedPath(pathname: string): void {
  renderedPath = morphKey(pathname);
}

// ---- The transition (browser only) -----------------------------------------

const PAGE_AREA = "[data-traverse-page]";
/** Travel together or not at all. */
const PARTS: MorphPart[] = ["art", "title"];
/** Travel along when the side has them (not every card or hero has a metadata line). */
const OPTIONAL_PARTS: MorphPart[] = ["meta"];
/** A traversal the browser has not let us hand over after this long is handed over without animation. */
const HANDOVER_DEADLINE_MS = 500;
const LOG = "[traversalMorph]";

interface NavigationEntry {
  key: string;
  url: string | null;
  index: number;
}
interface NavigationApi extends EventTarget {
  currentEntry: NavigationEntry | null;
}
interface EntryChangeEvent extends Event {
  navigationType: string | null;
  from: NavigationEntry;
}
type TransitionDocument = Document & { activeViewTransition?: ViewTransition | null; __reactViewTransition?: ViewTransition | null };

interface Run {
  transition: ViewTransition | null;
  /** The router has been given the traversal. */
  delivered: boolean;
  /** A newer traversal took over; this one must not reach the router any more. */
  superseded: boolean;
  /** The browser will not animate it (any more): skipped by a newer traversal, a transition of React's or itself. */
  skipped: boolean;
}

let running: Run | null = null;
/** The mechanism failed once; traversals run unanimated until the next page load. */
let broken = false;
let lastTraversal: { from: EntryRef; to: EntryRef; direction: "back" | "forward" } | null = null;
const replays = new WeakSet<Event>();

function navigationApi(): NavigationApi | undefined {
  return (window as Window & { navigation?: NavigationApi }).navigation;
}

function entryRef(entry: NavigationEntry): EntryRef | null {
  return entry.url === null ? null : { key: entry.key, path: new URL(entry.url).pathname };
}

/** The card in list `scope` that opens `href` was clicked (see `useMorphSource`). */
export function noteCardClick(href: string, scope: string): void {
  const entry = navigationApi()?.currentEntry;
  // Without the Navigation API history entries cannot be told apart: Back/Forward cross-fades only.
  if (entry) armOpening(entry.key, href, scope);
}

function isSupported(): boolean {
  if (typeof document.startViewTransition !== "function") return false;
  if (!CSS.supports("view-transition-class", "x")) return false;
  // Without it a swipe that the browser animated itself would be animated twice.
  if (!("hasUAVisualTransition" in PopStateEvent.prototype)) return false;
  const event = Object.getOwnPropertyDescriptor(window, "event");
  return event !== undefined && event.configurable === true && typeof event.get === "function";
}

function boxOf(element: Element): Box {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

/** Whether `element` can travel: it is on screen, inside the page area and inside every scroller on the way up. */
function inView(element: Element, pageArea: Element): boolean {
  const clips: Box[] = [];
  for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(ancestor);
    if (overflowX !== "visible" || overflowY !== "visible") clips.push(boxOf(ancestor));
    if (ancestor === pageArea) return visibleFraction(boxOf(element), clips) >= MIN_VISIBLE;
  }
  return false;
}

type Parts = Map<MorphPart, Element>;

/**
 * Artwork and title of the hero, or of `card`, if both are there and in view,
 * plus the metadata line if that is too.
 */
function findParts(pageArea: Element, side: "hero" | "card", card: CardRef): Parts | null {
  const find = (part: MorphPart) => {
    const selector = side === "hero" ? `[data-traverse-hero="${part}"]` : `[data-traverse-card="${morphName(part, card.path, card.scope)}"]`;
    const element = pageArea.querySelector(selector);
    return element !== null && inView(element, pageArea) ? element : null;
  };
  const found: Parts = new Map();
  for (const part of PARTS) {
    const element = find(part);
    if (element === null) return null;
    found.set(part, element);
  }
  for (const part of OPTIONAL_PARTS) {
    const element = find(part);
    if (element !== null) found.set(part, element);
  }
  return found;
}

function markParts(parts: Parts): void {
  for (const [part, element] of parts) element.setAttribute("data-traverse", part);
}

function unmarkParts(): void {
  for (const element of document.querySelectorAll('[data-traverse]:not([data-traverse="page"])')) element.removeAttribute("data-traverse");
}

function unmarkAll(): void {
  for (const element of document.querySelectorAll("[data-traverse]")) element.removeAttribute("data-traverse");
  document.documentElement.removeAttribute("data-traversing");
  document.documentElement.removeAttribute("data-traverse-direction");
}

/** Nothing (a dialog, the fullscreen player) lies over the page area, which the transition would paint on top of. */
function isUncovered(pageArea: Element): boolean {
  const { left, top, width, height } = pageArea.getBoundingClientRect();
  const topmost = document.elementFromPoint(left + width / 2, top + height / 2);
  return topmost !== null && pageArea.contains(topmost);
}

/**
 * Hands the traversal to the router and everything else that listens for
 * `popstate`. `window.event` reports the replayed event until React's
 * scheduler microtask has run (see the header).
 */
function deliver(run: Run, replay: PopStateEvent): () => void {
  const original = Object.getOwnPropertyDescriptor(window, "event");
  let restore = () => {};
  try {
    if (original === undefined) throw new Error("window.event is gone");
    Object.defineProperty(window, "event", { configurable: true, enumerable: original.enumerable, get: () => replay });
    restore = () => Object.defineProperty(window, "event", original);
  } catch (error) {
    // The router still gets the traversal below; React will just not render it at once.
    broken = true;
    console.error(`${LOG} window.event could not be redirected; Back/Forward runs without a view transition from here on.`, error);
  }
  run.delivered = true;
  replays.add(replay);
  window.dispatchEvent(replay);
  return restore;
}

/**
 * The update callback of the view transition: shows the destination and names
 * the new half of `pair` (the pair whose old half has been captured, if any).
 */
async function update(run: Run, replay: PopStateEvent, pair: ReturnType<typeof traversalPair>, destination: string): Promise<void> {
  // Superseded: the newer traversal has gone to the router directly, and this
  // one's `state` no longer matches `location`. Delivered: the deadline did it.
  if (run.superseded || run.delivered) return;
  try {
    // The view transition shows the page; it must not also fade in on its own.
    forgetTraversal();
    const restore = deliver(run, replay);
    try {
      // React flushes the navigation in a microtask queued during the dispatch, before this one.
      await Promise.resolve();
    } finally {
      restore();
    }
    const pageArea = document.querySelector(PAGE_AREA);
    // The destination has no page area (signed-out screens): nothing to animate.
    if (pageArea === null) return run.transition!.skipTransition();
    if (morphKey(pageArea.getAttribute("data-traverse-page")!) !== destination) {
      // Not on screen yet: it appears whenever React shows it, with the plain fade.
      noteTraversal(destination);
      run.transition!.skipTransition();
      if (renderedPath !== destination && !broken) {
        broken = true;
        console.error(
          `${LOG} React did not render the history traversal to ${destination} synchronously when it was handed the replayed popstate event. ` +
            "The router's popstate handling or React's popstate detection has changed (see the header of lib/traversalMorph.ts). " +
            "Back/Forward runs without a view transition until the page is reloaded.",
        );
      }
      return;
    }
    // Skipped before it began (React started a transition of its own): nothing left to name.
    if (pair === null || run.skipped) return;
    // The old half is captured; whatever of it is still in the document must not be captured again.
    unmarkParts();
    const parts = findParts(pageArea, pair.hero === "new" ? "hero" : "card", pair.card);
    if (parts !== null) markParts(parts);
    // No counterpart on screen: the old half fades with its page instead of travelling.
    else document.documentElement.setAttribute("data-traversing", "fade");
  } catch (error) {
    // The router has the traversal (`deliver` guarantees it); only the animation is lost.
    console.error(`${LOG} The view transition for the history traversal to ${destination} failed; the navigation itself was handed to the router.`, error);
    run.transition!.skipTransition();
  }
}

function onPopState(event: PopStateEvent): void {
  if (replays.has(event)) return;
  if (running !== null) {
    // Back, Back: end the transition on screen and let this traversal through
    // at once. If the earlier one has not reached the router yet it never
    // will; the history has moved past its entry, and its state would be
    // restored under this entry's URL.
    const previous = running;
    running = null;
    previous.superseded = true;
    unmarkAll();
    previous.transition!.skipTransition();
    return;
  }
  if (broken) return;
  const pageArea = document.querySelector(PAGE_AREA);
  const shown = pageArea?.getAttribute("data-traverse-page");
  const destination = morphKey(window.location.pathname);
  const doc = document as TransitionDocument;
  const verdict = judgeTraversal({
    supported: isSupported(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    uaTransition: event.hasUAVisualTransition === true,
    routerEntry: (event.state as { __NA?: unknown } | null)?.__NA === true,
    documentVisible: document.visibilityState === "visible",
    transitionRunning: doc.activeViewTransition != null || doc.__reactViewTransition != null,
    pageAreaFree: pageArea != null && shown != null && isUncovered(pageArea),
    from: shown ?? "",
    to: destination,
  });
  if (verdict !== "animate") return;

  const traversal = lastTraversal;
  const currentKey = navigationApi()?.currentEntry?.key;
  const pair = traversal !== null && traversal.to.key === currentKey ? traversalPair(traversal.from, traversal.to) : null;
  const run: Run = { transition: null, delivered: false, superseded: false, skipped: false };
  const replay = new PopStateEvent("popstate", { state: event.state });
  try {
    const oldParts = pair === null ? null : findParts(pageArea!, pair.hero === "old" ? "hero" : "card", pair.card);
    document.documentElement.setAttribute("data-traversing", "");
    // Unknown (the entry change was not seen): the page sinks and rises instead of sliding.
    if (traversal !== null && traversal.to.key === currentKey) document.documentElement.setAttribute("data-traverse-direction", traversal.direction);
    pageArea!.setAttribute("data-traverse", "page");
    if (oldParts !== null) markParts(oldParts);
    run.transition = document.startViewTransition(() => update(run, replay, oldParts === null ? null : pair, destination));
  } catch (error) {
    // Not stopped: the event goes on to the router as if this module were not there.
    unmarkAll();
    broken = true;
    throw new Error(`${LOG} Could not start the view transition for the history traversal to ${destination}. Back/Forward runs without one until the page is reloaded.`, { cause: error });
  }
  // From here on the router gets the traversal from `update` (or the deadline below).
  event.stopImmediatePropagation();
  running = run;
  const transition = run.transition;

  const deadline = window.setTimeout(() => {
    if (run.delivered || run.superseded) return;
    console.error(`${LOG} The browser did not start the view transition within ${HANDOVER_DEADLINE_MS} ms; the traversal to ${destination} is handed to the router without it.`);
    unmarkAll();
    // Unanimated, so the page fades in on its own as on every other plain traversal.
    noteTraversal(destination);
    queueMicrotask(deliver(run, replay));
    transition.skipTransition();
  }, HANDOVER_DEADLINE_MS);
  const finish = () => {
    window.clearTimeout(deadline);
    if (running !== run) return;
    running = null;
    unmarkAll();
  };
  transition.finished.then(finish, finish);
  transition.ready.catch((error: unknown) => {
    // The names are of no use any more, and whoever takes over must not capture them.
    run.skipped = true;
    if (running === run) unmarkAll();
    // Skipped on purpose (a newer traversal, a transition of React's, `update` giving up).
    if (error instanceof DOMException && error.name === "AbortError") return;
    console.error(`${LOG} The browser refused the view transition for the history traversal to ${destination}.`, error);
  });
}

function onEntryChange(event: Event): void {
  const { navigationType, from } = event as EntryChangeEvent;
  const current = navigationApi()?.currentEntry;
  if (!current) throw new Error(`${LOG} currententrychange fired without a current history entry.`);
  const left = entryRef(from);
  const arrived = entryRef(current);
  // An entry without a URL belongs to another origin's document; nothing of ours.
  if (left === null || arrived === null) return;
  noteEntryChange(navigationType, left.key, arrived.key, arrived.path);
  if (navigationType === "traverse") lastTraversal = { from: left, to: arrived, direction: current.index < from.index ? "back" : "forward" };
}

/** Starts animating Back/Forward; call once in the shell. Returns the undo. */
export function installTraversalMorph(): () => void {
  const navigation = navigationApi();
  navigation?.addEventListener("currententrychange", onEntryChange);
  // Capture phase: ahead of the router's listener and the search provider's, whenever those were added.
  window.addEventListener("popstate", onPopState, true);
  return () => {
    navigation?.removeEventListener("currententrychange", onEntryChange);
    window.removeEventListener("popstate", onPopState, true);
  };
}
