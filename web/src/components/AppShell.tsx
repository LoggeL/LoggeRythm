"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import PlayerBar from "@/components/PlayerBar";
import MobileNav from "@/components/MobileNav";
import Toaster from "@/components/Toast";
import PwaBanner from "@/components/PwaBanner";
import QueueSidebar from "@/components/QueueSidebar";
import CommandPalette from "@/components/CommandPalette";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import Lyrics from "@/components/Lyrics";
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
import { useMe } from "@/hooks/useAuth";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe();

  // Reset scroll position on route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Login/register are always reachable (minimal chrome) so users can get in.
  const authRoute = pathname === "/login" || pathname === "/register";
  if (authRoute) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        {children}
        <Toaster />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <div role="alert">
          <h1 className="text-xl font-bold mb-2">Sitzung konnte nicht geladen werden</h1>
          <p className="text-red-300">{error.message}</p>
        </div>
        <button type="button" disabled={isFetching} onClick={() => void refetch()} className="rounded-full bg-accent px-5 py-2 text-white disabled:opacity-50">
          {isFetching ? "Lädt…" : "Erneut versuchen"}
        </button>
      </div>
    );
  }

  // Still resolving the session.
  if (isPending && me === undefined) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted">
        Lädt…
      </div>
    );
  }

  // Locked down: not logged in, or logged in but not approved.
  if (!me) {
    return (
      <>
        <LandingScreen />
        <Toaster />
      </>
    );
  }
  if (!me.is_approved) {
    return (
      <>
        <PendingScreen />
        <Toaster />
      </>
    );
  }

  // Full app — approved users only.
  return (
    <div className="h-full flex flex-col bg-background">
      <a href="#main-content" className="fixed left-4 top-4 z-[150] -translate-y-24 focus:translate-y-0 action-primary">Zum Inhalt</a>
      <PwaBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col bg-background">
          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            className="flex-1 min-h-0 overflow-y-auto scroll-area"
          >
            <div className="px-5 sm:px-8 xl:px-10 pb-10 max-w-[88rem] mx-auto">
              <TopBar />
              <div key={pathname} className="animate-in pt-4 sm:pt-6">
                {children}
              </div>
            </div>
          </main>
          {/* Lyrics dock sits at the bottom of the main column only, so the
              sidebar and queue run full-height down to the player bar. */}
          <Lyrics />
        </div>
        <QueueSidebar />
      </div>
      <PlayerBar />
      <MobileNav />
      <CommandPalette />
      <AddToPlaylistModal />
      <Toaster />
    </div>
  );
}
