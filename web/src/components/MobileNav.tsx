"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  SearchIcon,
  LibraryIcon,
  ImportIcon,
  UserIcon,
} from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/search", label: "Suche", icon: SearchIcon },
  { href: "/library", label: "Bibliothek", icon: LibraryIcon },
  { href: "/import", label: "Import", icon: ImportIcon },
  { href: "/account", label: "Konto", icon: UserIcon },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden flex-shrink-0 z-40 bg-panel/95 backdrop-blur border-t border-white/10 flex justify-around px-1 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-[10px] px-1 py-1 ${
              active ? "text-foreground" : "text-muted"
            }`}
          >
            <Icon width={22} height={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
