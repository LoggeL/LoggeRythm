import type { ComponentType, SVGProps } from "react";
import { HomeIcon, SearchIcon, CompassIcon, RadioIcon, LibraryIcon } from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Extra path prefixes that should light this item up. */
  also?: string[];
  /** Hidden in the desktop sidebar, where the library has its own section. */
  mobileOnly?: boolean;
}

/** The app's primary destinations, shared by the sidebar and the tab bar. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Start", icon: HomeIcon, also: ["/mix", "/radar"] },
  { href: "/search", label: "Suchen", icon: SearchIcon },
  { href: "/genre", label: "Entdecken", icon: CompassIcon },
  { href: "/radio", label: "Radio", icon: RadioIcon },
  { href: "/library", label: "Bibliothek", icon: LibraryIcon, also: ["/playlist"], mobileOnly: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/" || (item.also ?? []).some((prefix) => pathname.startsWith(prefix));
  return [item.href, ...(item.also ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
