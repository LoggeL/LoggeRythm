"use client";

import { ViewTransition, useContext, useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ShelfScope } from "@/components/browse/Shelf";
import { armMorph, isTraversal, morphName, morphSeedFor, morphTargetName, noteTraversal, settleMorph, subscribeMorph, type MorphPart, type MorphSeed } from "@/lib/morph";

/**
 * Motion wiring on top of React's `<ViewTransition>` (the animations live in
 * globals.css under "View transitions"):
 *
 * - `PageTransition` cross-fades the page area whenever a navigation or a
 *   deferred update changes it.
 * - `Morph` marks one half of a shared element; a card (`useMorphSource`) and
 *   the hero of the page it opens (`HeroMorph`) carry the same name, so the
 *   artwork and the title travel between them.
 *
 * Browsers without the View Transitions API render the same tree unanimated.
 */

/** Cross-fades its child (the scrolling page area) when its content changes in a transition. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" update="page">
      {children}
    </ViewTransition>
  );
}

/**
 * One half of a shared-element pair around a single element; it only moves
 * when the other half with the same name appears or disappears in the same
 * transition. `name` must not change while mounted. Without one it does nothing.
 */
export function Morph({ name, part, children }: { name: string | undefined; part: MorphPart; children: ReactNode }) {
  return (
    <ViewTransition name={name} share={part === "art" ? "morph" : "morph-text"} default="none">
      {children}
    </ViewTransition>
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
    <Morph name={name} part={part}>
      {children}
    </Morph>
  );
}

/**
 * The card's half of the pair: `art` and `title` name the card's artwork and
 * title, and `arm` (the link's `onClick`) tells the page being opened which
 * card it comes from and what that card shows.
 */
export function useMorphSource(href: string | undefined, seed: MorphSeed) {
  const pathname = usePathname();
  const scope = useContext(ShelfScope);
  return {
    art: href === undefined ? undefined : morphName("art", href, scope),
    title: href === undefined ? undefined : morphName("title", href, scope),
    arm(event: MouseEvent) {
      // Only a plain click navigates in this tab; modified clicks open elsewhere.
      if (href === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      armMorph(href, scope, pathname, seed);
    },
  };
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

/** The parts of the Navigation API's `navigate` event used here (not yet in TypeScript's DOM types). */
interface HistoryNavigateEvent extends Event {
  navigationType: "push" | "replace" | "reload" | "traverse";
  destination: { url: string };
}

/**
 * Keeps the motion bookkeeping in step with navigation; call once in the
 * shell. Returns the class for the element that holds the current page:
 * `page-enter` normally (the view transition animates it), `page-return` when
 * the page was reached with Back/Forward, which React commits without a view
 * transition, so the page fades in by itself.
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
