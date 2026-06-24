"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, SearchIcon, LibraryIcon } from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/search", label: "Suche", icon: SearchIcon },
  { href: "/library", label: "Bibliothek", icon: LibraryIcon },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-20 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-white/10 flex justify-around py-2">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-1 text-[11px] px-4 py-1 ${
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
