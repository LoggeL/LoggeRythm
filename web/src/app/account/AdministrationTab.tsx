"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusIcon, UsersIcon, VisualizerIcon } from "@/components/icons";
import { DiskIcon } from "./_admin/statusIcons";
import { ADMIN_SECTIONS, parseAdminSection, type AdminSection } from "./_admin/sections";
import UsageSection from "./_admin/UsageSection";
import UsersAndInvitesSection from "./_admin/UsersAndInvitesSection";
import StorageSection from "./_admin/StorageSection";
import StatusSection from "./_admin/StatusSection";

const SECTION_ICONS: Record<AdminSection, ReactNode> = {
  usage: <VisualizerIcon width={15} height={15} />,
  users: <UsersIcon width={15} height={15} />,
  storage: <DiskIcon width={15} height={15} />,
  status: <StatusIcon width={15} height={15} />,
};

/**
 * Unified "Verwaltung" hub (admins only): usage analytics, users & invites,
 * server cache storage, and live system status inside the Account page.
 */
export default function AdministrationTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = parseAdminSection(searchParams.get("section"));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectSection(next: AdminSection) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "admin");
    params.set("section", next);
    if (next !== "usage") {
      params.delete("range");
      params.delete("user");
    }
    router.replace(`/account?${params.toString()}`, { scroll: false });
  }

  function onSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const count = ADMIN_SECTIONS.length;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? count - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
    selectSection(ADMIN_SECTIONS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div
        role="tablist"
        aria-label="Verwaltungsbereiche"
        className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-hairline px-4 sm:mx-0 sm:px-0"
      >
        {ADMIN_SECTIONS.map((item, index) => {
          const active = section === item.key;
          return (
            <button
              key={item.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`admin-section-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="admin-section-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => selectSection(item.key)}
              onKeyDown={(event) => onSectionKeyDown(event, index)}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              <span className={active ? "text-accent-soft" : ""}>{SECTION_ICONS[item.key]}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      <section
        id="admin-section-panel"
        role="tabpanel"
        aria-labelledby={`admin-section-tab-${section}`}
        tabIndex={-1}
        className="min-w-0 outline-none"
      >
        <div key={section} className="animate-in">
          {section === "usage" && <UsageSection />}
          {section === "users" && <UsersAndInvitesSection />}
          {section === "storage" && <StorageSection />}
          {section === "status" && <StatusSection />}
        </div>
      </section>
    </div>
  );
}
