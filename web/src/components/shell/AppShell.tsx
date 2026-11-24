"use client";

import { Suspense, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MobileNav from "@/components/shell/MobileNav";
import PlayerBar from "@/components/player/PlayerBar";
import PlaybackEngine from "@/components/player/PlaybackEngine";
import ConnectEngine from "@/components/player/ConnectEngine";
import { DeviceSelectorHost } from "@/components/player/DeviceSelector";
import PartySessionManager from "@/components/party/PartySessionManager";
import Toaster from "@/components/Toast";
import PwaBanner from "@/components/PwaBanner";
import QueueSidebar from "@/components/QueueSidebar";
import CommandPalette from "@/components/CommandPalette";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import Lyrics from "@/components/Lyrics";
import Logo from "@/components/Logo";
import { AuthShell } from "@/components/AuthCard";
import { SpinnerIcon } from "@/components/icons";
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
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

function SessionError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <AuthShell compact>
        <section role="alert" aria-labelledby="session-error-title">
          <p className="page-eyebrow">Sitzungsfehler</p>
          <h1 id="session-error-title" className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] [text-wrap:balance]">
            Sitzung konnte nicht geladen werden
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">Die Anmeldung ließ sich nicht prüfen. Die App bleibt gesperrt, bis das klappt.</p>
          <div className="error-panel mt-8">
            <p className="label-mono mb-1.5 text-danger">Fehlermeldung</p>
            <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{message}</p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" disabled={retrying} aria-busy={retrying} onClick={onRetry} className="action-primary min-h-12 flex-1 text-[15px]">
              {retrying && <SpinnerIcon width={18} height={18} aria-hidden className="animate-spin motion-reduce:animate-none" />}
              {retrying ? "Lädt…" : "Erneut versuchen"}
            </button>
          </div>
        </section>
      </AuthShell>
    </div>
  );
}

/** The signed-in application frame: panels, player and global overlays. */
function Workspace({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useAmbientColor();
  const pageMotion = usePageMotion();

  // Reset scroll position on route change. As a layout effect it lands before
  // the route's view transition captures the new page, so the cross-fade ends
  // on the page as it will be shown instead of jumping afterwards.
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
              {/* Only the page area moves on navigation; sidebar, player and panels stay put. Its own
                  opaque background keeps the old page from showing through the new one in flight. */}
              <PageTransition>
                {/* data-traverse-page: the page area and the page it shows, for lib/traversalMorph.ts. */}
                <main ref={mainRef} id="main-content" data-traverse-page={pathname} tabIndex={-1} className="scroll-area ambient-wash min-h-0 flex-1 bg-background overflow-y-auto outline-none">
                  <TopBar />
                  <div key={pathname} className={`${pageMotion} mx-auto max-w-[96rem] px-4 pb-16 pt-3 sm:px-6 lg:px-10 lg:pt-6`}>
                    {children}
                  </div>
                </main>
              </PageTransition>
              {/* Lyrics dock sits at the bottom of the main column only. */}
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
          <DeviceSelectorHost />
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
 * everything else requires an approved account.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe();
  useTraversalMorph();

  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        {children}
        <Toaster />
      </div>
    );
  }
  if (isError) return <SessionError message={error.message} retrying={isFetching} onRetry={() => void refetch()} />;
  if (isPending && me === undefined) return <SplashScreen />;
  if ((!me || !me.is_approved) && isPartyInvitePath(pathname)) {
    // An invite link works without an account: the party page lets the
    // visitor join anonymously with a nickname. Nothing else is reachable.
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
        {me ? <PendingScreen /> : <LandingScreen />}
        <Toaster />
      </>
    );
  }
  return <Workspace>{children}</Workspace>;
}
