"use client";

import Link from "next/link";
import { NAV_LATERAL } from "@/lib/morph";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "@/components/shell/navigation";

/** Bottom tab bar for touch layouts. */
export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="z-40 flex shrink-0 justify-around border-t border-hairline bg-backdrop px-1 pt-1 pb-[calc(.25rem+env(safe-area-inset-bottom))] lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            transitionTypes={NAV_LATERAL}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors ${active ? "text-foreground" : "text-subtle"}`}
          >
            {active && <span aria-hidden="true" className="vt-tab-marker absolute -top-1 h-[3px] w-8 rounded-b-full bg-accent" />}
            <span className={`grid h-7 place-items-center ${active ? "text-accent" : ""}`}>
              <Icon width={22} height={22} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
