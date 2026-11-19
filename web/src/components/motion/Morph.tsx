"use client";

import { ViewTransition, cloneElement, createContext, isValidElement, useContext, useEffect, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ShelfScope } from "@/components/browse/Shelf";
import { NAV_FORWARD, armMorph, isTraversal, morphName, morphSeedFor, morphTargetName, noteTraversal, settleMorph, subscribeMorph, type MorphPart, type MorphSeed } from "@/lib/morph";
import { installTraversalMorph, noteCardClick, noteRenderedPath } from "@/lib/traversalMorph";

/**
 * Motion wiring on top of React's `<ViewTransition>` (the animations live in
 * globals.css under "View transitions"):
 *
 * - `PageTransition` animates the page area whenever a navigation or a
 *   deferred update changes it. How depends on the transition type the
 *   navigation carries: `NAV_FORWARD` (a link that opens something) pushes
 *   the new page in from the right, `NAV_LATERAL` (the primary navigation)
 *   lets the old page sink away and the new one rise; anything untyped (a
 *   loaded page replacing its placeholder, other links) only cross-fades.
 * - `Morph` marks one half of a shared element; a card (`useMorphSource`) and
 *   the hero of the page it opens (`HeroMorph`) carry the same name, so the
 *   artwork, the title and the metadata line travel between them.
 * - `useHeroRise` lets the rest of a hero (eyebrow, description, actions)
 *   rise in one after the other while the shared elements land.
 *
 * Back/Forward is not a React transition; `lib/traversalMorph.ts` animates it
 * and finds the same elements through the `data-traverse-*` attributes set here.
 *
 * Browsers without the View Transitions API render the same tree unanimated.
 */

/** Animates its child (the scrolling page area) when its content changes in a transition. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" update={{ "nav-forward": "page-forward", "nav-lateral": "page-lateral", default: "page" }}>
      {children}
    </ViewTransition>
  );
}

/**
 * `children` (one element that passes unknown props on to its DOM element)
 * with `attribute` set, which is how `lib/traversalMorph.ts` finds it.
 */
function tagged(children: ReactNode, attribute: "data-traverse-card" | "data-traverse-hero", value: string | undefined): ReactNode {
  if (value === undefined) return children;
  if (!isValidElement(children)) throw new Error("A morph wraps exactly one element; it cannot mark text or several children.");
  return cloneElement(children as ReactElement<Record<string, unknown>>, { [attribute]: value });
}

/** `view-transition-class` of each part in flight (globals.css, "View transitions"). */
const SHARE_CLASS: Record<MorphPart, string> = { art: "morph", title: "morph-text", meta: "morph-meta" };

function Shared({ name, part, children }: { name: string | undefined; part: MorphPart; children: ReactNode }) {
  return (
    <ViewTransition name={name} share={SHARE_CLASS[part]} default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * A card's half of a shared-element pair around a single element; it only
 * moves when the other half with the same name appears or disappears in the
 * same transition. `name` must not change while mounted. Without one it does nothing.
 */
export function Morph({ name, part, children }: { name: string | undefined; part: MorphPart; children: ReactNode }) {
  return (
    <Shared name={name} part={part}>
      {tagged(children, "data-traverse-card", name)}
    </Shared>
  );
}

/**
 * The hero's half of the pair. A hero that mounts while its page is being
 * opened from a card takes that card's name; any other hero has none.
 */
export function HeroMorph({ part, children }: { part: MorphPart; children: ReactNode }) {
  const pathname = usePathname();
  // Fixed at mount: the name belongs to the navigation that brought the hero up.
  const [name] = useState(() => morphTargetName(part, pathname) ?? undefined);
  return (
    <Shared name={name} part={part}>
      {tagged(children, "data-traverse-hero", part)}
    </Shared>
  );
}

/**
 * The card's half of the pair: `art`, `title` and `meta` name the card's
 * artwork, title and metadata line, `arm` (the link's `onClick`) tells the
 * page being opened which card it comes from and what that card shows, and
 * `types` (the link's `transitionTypes`) makes the page push in.
 */
export function useMorphSource(href: string | undefined, seed: MorphSeed) {
  const pathname = usePathname();
  const scope = useContext(ShelfScope);
  return {
    art: href === undefined ? undefined : morphName("art", href, scope),
    title: href === undefined ? undefined : morphName("title", href, scope),
    meta: href === undefined ? undefined : morphName("meta", href, scope),
    types: NAV_FORWARD,
    arm(event: MouseEvent) {
      // Only a plain click navigates in this tab; modified clicks open elsewhere.
      if (href === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      armMorph(href, scope, pathname, seed);
      noteCardClick(href, scope);
    },
  };
}

/**
 * Whether a hero that mounts here arrives with its page (its secondary parts
 * rise in) or replaces a placeholder hero that already did (they stay put, so
 * loaded content does not bounce in a second time).
 */
export const HeroEntrance = createContext(true);

/**
 * Props for the `step`-th secondary part of a hero (0 first): it rises in a
 * little after the one before while the shared elements land. Nothing when
 * the hero replaces a placeholder (see `HeroEntrance`).
 */
export function useHeroRise(): (step: number) => { "data-rise"?: ""; style?: CSSProperties } {
  const rises = useContext(HeroEntrance);
  return (step) => (rises ? { "data-rise": "", style: { "--rise": step } as CSSProperties } : {});
}

/** What the card that opened this page showed, for drawing the hero before the page's data arrives. */
export function useMorphSeed(): MorphSeed | null {
  const pathname = usePathname();
  return useSyncExternalStore(
    subscribeMorph,
    () => morphSeedFor(pathname),
    () => null,
  );
}

/**
 * Animates Back/Forward (`lib/traversalMorph.ts`); call once at the top of the
 * shell, where every route renders.
 */
export function useTraversalMorph(): void {
  const pathname = usePathname();
  // During render on purpose: it records that React rendered this path, even
  // if the render could not be shown yet. Idempotent; it only tells a page that
  // is still loading from a mechanism that stopped working.
  noteRenderedPath(pathname);
  useEffect(() => installTraversalMorph(), []);
}

/** The parts of the Navigation API's `navigate` event used here (not yet in TypeScript's DOM types). */
interface HistoryNavigateEvent extends Event {
  navigationType: "push" | "replace" | "reload" | "traverse";
  destination: { url: string };
}

/**
 * Keeps the motion bookkeeping in step with navigation; call once in the
 * shell. Returns the class for the element that holds the current page:
 * `page-enter` normally (the view transition animates it), `page-return` when
 * the page was reached with Back/Forward and `lib/traversalMorph.ts` did not
 * animate it: React commits it without a view transition, so the page fades in
 * by itself.
 */
export function usePageMotion(): "page-enter" | "page-return" {
  const pathname = usePathname();
  useEffect(() => {
    settleMorph(pathname);
  }, [pathname]);
  useEffect(() => {
    // The Navigation API announces a history traversal before the router
    // renders it (a `popstate` listener added here would run after the
    // router's). Browsers without it show Back/Forward unanimated.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    if (!navigation) return;
    const onNavigate = (event: Event) => {
      const { navigationType, destination } = event as HistoryNavigateEvent;
      if (navigationType === "traverse") noteTraversal(new URL(destination.url).pathname);
    };
    navigation.addEventListener("navigate", onNavigate);
    return () => navigation.removeEventListener("navigate", onNavigate);
  }, []);
  const traversal = useSyncExternalStore(
    subscribeMorph,
    () => isTraversal(pathname),
    () => false,
  );
  return traversal ? "page-return" : "page-enter";
}
