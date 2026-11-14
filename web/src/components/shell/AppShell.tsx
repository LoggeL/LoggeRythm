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
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
import { useMe } from "@/hooks/useAuth";
import { useAmbientColor } from "@/hooks/useAmbientColor";
import { SearchProvider } from "@/hooks/useSearchNavigation";

function SplashScreen() {
  return (
    <div role="status" aria-label="LoggeRythm wird geladen" className="grid h-full place-items-center bg-backdrop">
      <Logo size={56} className="animate-pulse" />
    </div>
  );
}

function SessionError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-backdrop p-6 text-center">
      <Logo size={48} />
      <div role="alert" className="max-w-md">
        <h1 className="mb-2 text-xl font-bold">Sitzung konnte nicht geladen werden</h1>
        <p className="text-sm leading-relaxed text-danger">{message}</p>
      </div>
      <button type="button" disabled={retrying} onClick={onRetry} className="action-primary">
        {retrying ? "Lädt…" : "Erneut versuchen"}
      </button>
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
          <div className="flex min-h-0 flex-1 gap-2 lg:p-2 lg:pb-0">
            <Sidebar />
            <div className="app-panel relative flex min-w-0 flex-1 flex-col overflow-hidden max-lg:rounded-none">
              <main ref={mainRef} id="main-content" tabIndex={-1} className="scroll-area ambient-wash min-h-0 flex-1 overflow-y-auto outline-none">
                <TopBar />
                <div key={pathname} className="animate-in mx-auto max-w-[92rem] px-4 pb-12 pt-2 sm:px-6 lg:px-8">
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

/**
 * Session gate. Login and registration are always reachable; everything else
 * requires an approved account.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe();

  if (pathname === "/login" || pathname === "/register") {
    return (
      <div className="h-full overflow-y-auto bg-backdrop">
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
