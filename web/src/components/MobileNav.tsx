"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, SearchIcon, LibraryIcon, CompassIcon } from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Start", icon: HomeIcon },
  { href: "/search", label: "Suche", icon: SearchIcon },
  { href: "/genre", label: "Entdecken", icon: CompassIcon },
  { href: "/library", label: "Bibliothek", icon: LibraryIcon },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="lg:hidden flex-shrink-0 z-40 flex justify-around border-t border-border bg-background-elevated px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))]">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) || (href === "/genre" && pathname.startsWith("/radio"));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition ${active ? "text-accent-soft" : "text-muted hover:text-foreground"}`}>
            <span className={`grid h-7 w-12 place-items-center rounded-lg ${active ? "bg-accent/15" : ""}`}><Icon width={21} height={21} /></span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
