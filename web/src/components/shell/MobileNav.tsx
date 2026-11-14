"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/navigation";

/** Bottom tab bar for touch layouts. */
export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="z-40 flex shrink-0 justify-around border-t border-hairline bg-background px-1 pt-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10.5px] font-semibold transition-colors ${active ? "text-foreground" : "text-subtle"}`}
          >
            <span className={`grid h-7 w-14 place-items-center rounded-full transition-colors ${active ? "bg-white/10 text-accent-soft" : ""}`}>
              <Icon width={21} height={21} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
