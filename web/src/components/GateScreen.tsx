"use client";

import Link from "next/link";
import { useMe, useLogout } from "@/hooks/useAuth";
import Logo from "@/components/Logo";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="animate-in flex flex-col items-center gap-6 max-w-md">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <span className="text-3xl font-black tracking-tight">
            <span className="text-foreground">Logge</span>
            <span className="mx-1 text-white/35">|</span>
            <span className="text-accent">Rythm</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shown to logged-out visitors — the app is otherwise fully locked. */
export function LandingScreen() {
  return (
    <Shell>
      <p className="text-muted text-lg">
        Dein privater Musik-Stream. Melde dich an, um loszulegen.
      </p>
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="px-6 py-2.5 rounded-full border border-white/20 font-semibold hover:border-white/60 transition press"
        >
          Anmelden
        </Link>
        <Link
          href="/register"
          className="px-6 py-2.5 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover transition press"
        >
          Registrieren
        </Link>
      </div>
      <p className="text-xs text-muted">
        Ohne Konto ist die App gesperrt – kein Abspielen, keine Inhalte.
      </p>
    </Shell>
  );
}

/** Shown to logged-in but not-yet-approved users. */
export function PendingScreen() {
  const { data: me } = useMe();
  const logout = useLogout();
  return (
    <Shell>
      <h1 className="text-2xl font-bold">Konto wartet auf Freigabe</h1>
      <p className="text-muted">
        Hallo {me?.display_name || ""}! Dein Konto muss erst von einem Admin
        freigegeben werden. Schau später nochmal vorbei.
      </p>
      <button
        type="button"
        onClick={logout}
        className="px-6 py-2.5 rounded-full border border-white/20 font-semibold hover:border-white/60 transition press"
      >
        Abmelden
      </button>
    </Shell>
  );
}
