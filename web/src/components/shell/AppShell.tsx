"use client";

import { Suspense, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MobileNav from "@/components/shell/MobileNav";
import PlayerBar from "@/components/player/PlayerBar";
import PlaybackEngine from "@/components/player/PlaybackEngine";
import ConnectEngine from "@/components/player/ConnectEngine";
import { DeviceSelectorHost } from "@/components/player/DeviceSelector";
import { SleepTimerHost } from "@/components/player/SleepTimerControl";
import { AudioEffectsHost } from "@/components/player/AudioEffectsControl";
import PartySessionManager from "@/components/party/PartySessionManager";
import Toaster from "@/components/Toast";
import PwaBanner from "@/components/PwaBanner";
import QueueSidebar from "@/components/QueueSidebar";
import CommandPalette from "@/components/CommandPalette";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import SaveAsPlaylistModal from "@/components/SaveAsPlaylistModal";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import Lyrics from "@/components/Lyrics";
import Logo, { Wordmark } from "@/components/Logo";
import { AuthShell } from "@/components/AuthCard";
import { DownloadedIcon, RefreshIcon, SpinnerIcon } from "@/components/icons";
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
import DownloadsTab from "@/app/library/_tabs/DownloadsTab";
import { ApiError } from "@/lib/api";
import { hasOfflineDownloadsSnapshot } from "@/lib/offlineDownloads";
import { useMe } from "@/hooks/useAuth";
import { ImportJobWatcher } from "@/hooks/useImportJobs";
import { useAmbientColor } from "@/hooks/useAmbientColor";
import { SearchProvider } from "@/hooks/useSearchNavigation";
import { PageTransition, usePageMotion, useTraversalMorph } from "@/components/motion/Morph";

function SplashScreen() {
  return (
    <div role="status" aria-label="LoggeRythm wird geladen" className="grid h-full place-items-center bg-background">
      <Logo size={48} className="animate-pulse motion-reduce:animate-none" />
    </div>
  );
}

function offlineBypassState(error: unknown): { available: boolean; offlineError: string | null } {
  const isNetworkFailure =
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    (error instanceof ApiError && error.status === 0);
  if (!isNetworkFailure) return { available: false, offlineError: null };
  try {
    return { available: hasOfflineDownloadsSnapshot(), offlineError: null };
  } catch (cause) {
    return {
      available: false,
      offlineError: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function SessionError({
  message,
  offlineError,
  retrying,
  canOpenOffline,
  onRetry,
  onOpenOffline,
}: {
  message: string;
  offlineError: string | null;
  retrying: boolean;
  canOpenOffline: boolean;
  onRetry: () => void;
  onOpenOffline: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <AuthShell compact>
        <section role="alert" aria-labelledby="session-error-title">
          <p className="page-eyebrow">Sitzungsfehler</p>
          <h1 id="session-error-title" className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] [text-wrap:balance]">
            Sitzung konnte nicht geladen werden
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            {canOpenOffline
              ? "Der Server ist gerade nicht erreichbar. Du kannst deine lokal gespeicherten Downloads trotzdem im schreibgeschützten Offline-Modus abspielen."
              : "Die Anmeldung ließ sich nicht prüfen. Die App bleibt gesperrt, bis das klappt."}
          </p>
          <div className="error-panel mt-8">
            <p className="label-mono mb-1.5 text-danger">Fehlermeldung</p>
            <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{message}</p>
            {offlineError && (
              <p className="mt-2 text-xs text-danger/90 [overflow-wrap:anywhere]">
                Offline-Index konnte nicht gelesen werden: {offlineError}
              </p>
            )}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {canOpenOffline && (
              <button type="button" onClick={onOpenOffline} className="action-primary min-h-12 flex-1 text-[15px]">
                <DownloadedIcon width={18} height={18} aria-hidden="true" />
                Offline-Downloads öffnen
              </button>
            )}
            <button
              type="button"
              disabled={retrying}
              aria-busy={retrying}
              onClick={onRetry}
              className={`${canOpenOffline ? "action-secondary" : "action-primary"} min-h-12 flex-1 text-[15px]`}
            >
              {retrying && <SpinnerIcon width={18} height={18} aria-hidden className="animate-spin motion-reduce:animate-none" />}
              {retrying ? "Lädt…" : "Erneut versuchen"}
            </button>
          </div>
        </section>
      </AuthShell>
    </div>
  );
}

/**
 * Explicit read-only Offline Mode when `/auth/me` is unreachable while local
 * downloads exist on this device. Never fakes authentication — only serves
 * local cached downloads through the player and service worker.
 */
function OfflineWorkspace({ onReconnect, reconnecting }: { onReconnect: () => void; reconnecting: boolean }) {
  useAmbientColor();
  return (
    <div className="flex h-full flex-col bg-backdrop">
      <PwaBanner />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-background px-4 py-3 sm:px-6 lg:px-10">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <Wordmark />
          <span className="label-mono rounded-full border border-hairline bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-success">
            Offline-Modus
          </span>
        </div>
        <button
          type="button"
          disabled={reconnecting}
          onClick={onReconnect}
          className="action-secondary min-h-9 gap-2 px-3.5 text-xs"
        >
          <RefreshIcon width={14} height={14} className={reconnecting ? "animate-spin" : undefined} />
          {reconnecting ? "Verbindet…" : "Erneut verbinden"}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="app-panel relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="scroll-area ambient-wash min-h-0 flex-1 overflow-y-auto bg-background">
            <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6 lg:px-10">
              <DownloadsTab playlistsHref="/library?tab=downloads" offlineOnly />
            </div>
          </main>
          <Lyrics />
        </div>
        <QueueSidebar offlineOnly />
      </div>
      <PlaybackEngine />
      <PlayerBar offlineOnly />
      <SleepTimerHost />
      <AudioEffectsHost />
      <KeyboardShortcutsModal />
      <Toaster />
    </div>
  );
}

/** The signed-in application frame: panels, player and global overlays. */
function Workspace({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useAmbientColor();
  const pageMotion = usePageMotion();

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <Suspense fallback={<SplashScreen />}>
      <SearchProvider>
        <div className="flex h-full flex-col bg-backdrop">
          <a href="#main-content" className="action-primary fixed left-4 top-4 z-[150] -translate-y-24 focus:translate-y-0">
            Zum Inhalt
          </a>
          <PwaBanner />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <div className="app-panel relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <PageTransition>
                <main ref={mainRef} id="main-content" data-traverse-page={pathname} tabIndex={-1} className="scroll-area ambient-wash min-h-0 flex-1 bg-background overflow-y-auto outline-none">
                  <TopBar />
                  <div key={pathname} className={`${pageMotion} mx-auto max-w-[96rem] px-4 pb-16 pt-3 sm:px-6 lg:px-10 lg:pt-6`}>
                    {children}
                  </div>
                </main>
              </PageTransition>
              <Lyrics />
            </div>
            <QueueSidebar />
          </div>
          <PlaybackEngine />
          <PartySessionManager />
          <ConnectEngine />
          <PlayerBar />
          <MobileNav />
          <CommandPalette />
          <AddToPlaylistModal />
          <SaveAsPlaylistModal />
          <DeviceSelectorHost />
          <SleepTimerHost />
          <AudioEffectsHost />
          <KeyboardShortcutsModal />
          <Toaster />
          <ImportJobWatcher />
        </div>
      </SearchProvider>
    </Suspense>
  );
}

const PUBLIC_AUTH_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);

/** `/party/<code>` — the one app page visitors without an account may open. */
export function isPartyInvitePath(pathname: string): boolean {
  return /^\/party\/[^/]+\/?$/.test(pathname);
}

/**
 * Session gate. Login, registration and password reset are always reachable;
 * everything else requires an approved account — except an explicit read-only
 * Offline Mode when local downloads exist and the server is unreachable.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe();
  const [offlineMode, setOfflineMode] = useState(false);
  useTraversalMorph();

  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        {children}
        <Toaster />
      </div>
    );
  }
  if (isError) {
    const offline = offlineBypassState(error);
    if (offlineMode && offline.available) {
      return (
        <OfflineWorkspace
          reconnecting={isFetching}
          onReconnect={() => {
            void refetch().then((res) => {
              if (!res.isError) setOfflineMode(false);
            });
          }}
        />
      );
    }
    return (
      <SessionError
        message={error.message}
        offlineError={offline.offlineError}
        retrying={isFetching}
        canOpenOffline={offline.available}
        onRetry={() => void refetch()}
        onOpenOffline={() => setOfflineMode(true)}
      />
    );
  }
  if (isPending && me === undefined) return <SplashScreen />;
  if ((!me || !me.is_approved) && isPartyInvitePath(pathname)) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        {children}
        <Toaster />
      </div>
    );
  }
  if (!me || !me.is_approved) {
    return (
      <>
        {me ? <PendingScreen /> : <LandingScreen nextPath={pathname} />}
        <Toaster />
      </>
    );
  }
  return <Workspace>{children}</Workspace>;
}
