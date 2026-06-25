"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import PlayerBar from "@/components/PlayerBar";
import MobileNav from "@/components/MobileNav";
import Toaster from "@/components/Toast";
import QueueSidebar from "@/components/QueueSidebar";
import Lyrics from "@/components/Lyrics";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // Reset scroll position on route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main
          ref={mainRef}
          className="flex-1 min-w-0 overflow-y-auto scroll-area bg-background"
        >
          <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto pb-6">
            <div key={pathname} className="animate-in">
              {children}
            </div>
          </div>
        </main>
        <QueueSidebar />
      </div>
      <Lyrics />
      <PlayerBar />
      <MobileNav />
      <Toaster />
    </div>
  );
}
