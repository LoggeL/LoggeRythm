"use client";

import Link from "next/link";
import { Suspense, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import EmptyState from "@/components/ui/EmptyState";
import { ClockIcon, LockIcon, StatusIcon, UserIcon, VisualizerIcon } from "@/components/icons";
import ListeningStats from "@/components/profile/ListeningStats";
import AdministrationTab from "./AdministrationTab";
import PlaybackTab from "./PlaybackTab";
import ProfileHeader from "./ProfileHeader";
import ProfileTab from "./ProfileTab";

type AccountTab = "stats" | "playback" | "profile" | "admin";

const TABS: { key: AccountTab; label: string; icon: ReactNode; adminOnly?: boolean }[] = [
  { key: "stats", label: "Hörprofil", icon: <VisualizerIcon width={16} height={16} /> },
  { key: "playback", label: "Wiedergabe", icon: <ClockIcon width={16} height={16} /> },
  { key: "profile", label: "Profil", icon: <UserIcon width={16} height={16} /> },
  { key: "admin", label: "Verwaltung", icon: <StatusIcon width={16} height={16} />, adminOnly: true },
];

function AccountSkeleton() {
  return (
    <div role="status" aria-label="Konto wird geladen" className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-end gap-5">
        <span className="skeleton h-28 w-28 shrink-0 rounded-full" />
        <span className="flex-1">
          <span className="skeleton mb-3 block h-3 w-16 rounded" />
          <span className="skeleton mb-3 block h-10 w-2/3 max-w-sm rounded-lg" />
          <span className="skeleton block h-4 w-1/3 max-w-48 rounded" />
        </span>
      </div>
      <span className="skeleton block h-10 w-full max-w-md rounded-full" />
      <span className="skeleton block h-64 rounded-[var(--radius-panel)]" />
    </div>
  );
}

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me, isLoading, error, refetch, isFetching } = useMe();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (isLoading) return <AccountSkeleton />;

  if (error && !me) {
    return (
      <section role="alert" className="error-panel mx-auto flex max-w-xl flex-col items-start gap-3">
        <h1 className="text-xl font-semibold text-foreground">Konto konnte nicht geladen werden</h1>
        <p className="[overflow-wrap:anywhere]">{error.message}</p>
        <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary">
          {isFetching ? "Wird geladen…" : "Erneut versuchen"}
        </button>
      </section>
    );
  }

  if (!me) {
    return (
      <EmptyState
        className="mx-auto max-w-xl"
        icon={<UserIcon />}
        title="Du bist nicht angemeldet"
        action={
          <Link href="/login" className="action-primary">
            Anmelden
          </Link>
        }
      >
        Melde dich an, um dein Profil, deinen Hörverlauf und deine Einstellungen zu öffnen.
      </EmptyState>
    );
  }

  const tabs = TABS.filter((item) => !item.adminOnly || me.is_admin);
  const requested = searchParams.get("tab");
  const deniedAdmin = requested === "admin" && !me.is_admin;
  const tab: AccountTab = deniedAdmin
    ? "admin"
    : (tabs.find((item) => item.key === requested)?.key ?? "stats");

  function selectTab(next: AccountTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "admin") {
      params.delete("section");
      params.delete("range");
      params.delete("user");
    }
    router.replace(`/account?${params.toString()}`, { scroll: false });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  const wideLayout = tab === "admin" && !deniedAdmin;

  return (
    <div className={`mx-auto flex w-full min-w-0 flex-col gap-7 ${wideLayout ? "max-w-6xl" : "max-w-5xl"}`}>
      <ProfileHeader me={me} />

      {error && (
        <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 [overflow-wrap:anywhere]">Dein Profil konnte nicht aktualisiert werden: {error.message}</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary min-h-9 px-4 text-xs">
            {isFetching ? "Wird geladen…" : "Erneut versuchen"}
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Kontobereiche" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {tabs.map((item, index) => {
          const selected = !deniedAdmin && tab === item.key;
          return (
            <button
              key={item.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`account-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="account-panel"
              tabIndex={selected || (deniedAdmin && index === 0) ? 0 : -1}
              onClick={() => selectTab(item.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className="filter-chip min-h-11 shrink-0 px-4 sm:min-h-10"
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>

      <section
        id="account-panel"
        role={deniedAdmin ? undefined : "tabpanel"}
        aria-labelledby={deniedAdmin ? undefined : `account-tab-${tab}`}
        tabIndex={-1}
        className="min-w-0 outline-none"
      >
        <div key={tab} className="animate-in">
          {deniedAdmin ? (
            <EmptyState
              className="mx-auto max-w-xl"
              icon={<LockIcon />}
              title="Nur für Administratoren"
              action={
                <button type="button" onClick={() => selectTab("stats")} className="action-primary">
                  Zum Hörprofil
                </button>
              }
            >
              Die Verwaltung ist ausschließlich für Administratoren zugänglich.
            </EmptyState>
          ) : (
            <>
              {tab === "stats" && <ListeningStats />}
              {tab === "playback" && <PlaybackTab />}
              {tab === "profile" && <ProfileTab me={me} />}
              {tab === "admin" && <AdministrationTab />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountContent />
    </Suspense>
  );
}
