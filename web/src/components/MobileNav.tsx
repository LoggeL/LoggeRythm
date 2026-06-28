"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  SearchIcon,
  LibraryIcon,
  UserIcon,
} from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Start", icon: HomeIcon },
  { href: "/search", label: "Suche", icon: SearchIcon },
  { href: "/library", label: "Bibliothek", icon: LibraryIcon },
  { href: "/account", label: "Konto", icon: UserIcon },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden flex-shrink-0 z-40 bg-background/95 backdrop-blur-xl border-t border-white/5 flex justify-around px-1 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-[10px] px-1 py-1 transition ${
              active ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <span
              className={`flex items-center justify-center rounded-full px-3 py-0.5 transition ${
                active ? "bg-accent/15" : ""
              }`}
            >
              <Icon width={22} height={22} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
