"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import PlayerBar from "@/components/PlayerBar";
import MobileNav from "@/components/MobileNav";
import Toaster from "@/components/Toast";
import QueueSidebar from "@/components/QueueSidebar";
import CommandPalette from "@/components/CommandPalette";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import Lyrics from "@/components/Lyrics";
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { data: me, isLoading } = useMe();

  // Reset scroll position on route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Open the queue panel by default on desktop (mockup shows it open). Done in
  // an effect (not store init) to stay SSR-safe; mobile keeps it an overlay.
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      usePlayerStore.getState().setQueueOpen(true);
    }
  }, []);

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

  // Still resolving the session.
  if (isLoading && me === undefined) {
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
    <div className="h-full flex flex-col">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main
          ref={mainRef}
          className="flex-1 min-w-0 overflow-y-auto scroll-area bg-background"
        >
          <div className="px-4 sm:px-6 pb-6 max-w-[92rem] mx-auto">
            <TopBar />
            <div key={pathname} className="animate-in pt-2">
              {children}
            </div>
          </div>
        </main>
        <QueueSidebar />
      </div>
      <Lyrics />
      <PlayerBar />
      <MobileNav />
      <CommandPalette />
      <AddToPlaylistModal />
      <Toaster />
    </div>
  );
}
