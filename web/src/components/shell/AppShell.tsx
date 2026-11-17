"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MobileNav from "@/components/shell/MobileNav";
import PlayerBar from "@/components/player/PlayerBar";
import PlaybackEngine from "@/components/player/PlaybackEngine";
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
import { useAmbientColor } from "@/hooks/useAmbientColor";
import { SearchProvider } from "@/hooks/useSearchNavigation";

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

  // Reset scroll position on route change.
  useEffect(() => {
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
              <main ref={mainRef} id="main-content" tabIndex={-1} className="scroll-area ambient-wash min-h-0 flex-1 overflow-y-auto outline-none">
                <TopBar />
                <div key={pathname} className="animate-in mx-auto max-w-[96rem] px-4 pb-16 pt-3 sm:px-6 lg:px-10 lg:pt-6">
                  {children}
                </div>
              </main>
              {/* Lyrics dock sits at the bottom of the main column only. */}
              <Lyrics />
            </div>
            <QueueSidebar />
          </div>
          <PlaybackEngine />
          <PlayerBar />
          <MobileNav />
          <CommandPalette />
          <AddToPlaylistModal />
          <Toaster />
        </div>
      </SearchProvider>
    </Suspense>
  );
}

const PUBLIC_AUTH_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);

/**
 * Session gate. Login, registration and password reset are always reachable;
 * everything else requires an approved account.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe();

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
