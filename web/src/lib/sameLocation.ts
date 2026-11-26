/**
 * Links to the page the visitor is already on.
 *
 * A `next/link` click on the current URL still runs a navigation, and with it
 * the page transition (`PageTransition` in `components/motion/Morph.tsx`): the
 * page sinks away and the same page rises again. Such a click is stopped here
 * before the link sees it, so nothing moves. Clicks that open a new tab or
 * window, download, or go to another page, tab (query) or anchor (hash) pass.
 */

/** Whether `href` (relative or absolute) points exactly at `current`. */
export function isSameLocation(href: string, current: { href: string }): boolean {
  const here = new URL(current.href);
  const target = new URL(href, here);
  return (
    target.origin === here.origin &&
    normalizePath(target.pathname) === normalizePath(here.pathname) &&
    target.search === here.search &&
    target.hash === here.hash
  );
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** The click on `event.target` would only reload the current page through a link. */
export function isSameLocationLinkClick(event: MouseEvent, current: { href: string }): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!(event.target instanceof Element)) return false;
  const anchor = event.target.closest("a[href]");
  if (anchor === null) return false;
  const target = anchor.getAttribute("target");
  if ((target !== null && target !== "_self") || anchor.hasAttribute("download")) return false;
  return isSameLocation(anchor.getAttribute("href")!, current);
}

/**
 * Stops link clicks to the current page for the whole document. The listener
 * runs in the capture phase, before React's, so `next/link` finds the event
 * prevented and does not navigate. Returns the cleanup.
 */
export function installSameLocationGuard(doc: Document, current: { href: string }): () => void {
  const onClick = (event: MouseEvent) => {
    if (isSameLocationLinkClick(event, current)) event.preventDefault();
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
