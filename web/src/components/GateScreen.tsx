"use client";

import { useState } from "react";
import Link from "next/link";
import { useMe, useLogout } from "@/hooks/useAuth";
import { AuthShell } from "@/components/AuthCard";
import { ClockIcon, SpinnerIcon } from "@/components/icons";
import { CheckCircleIcon } from "@/components/feedbackIcons";
import { buildAuthHref } from "@/lib/authRedirect";
import { toast } from "@/store/toast";

/** Shown to logged-out visitors — the app is otherwise fully locked. */
export function LandingScreen({ nextPath }: { nextPath?: string | null }) {
  const loginHref = buildAuthHref("/login", nextPath);
  const registerHref = buildAuthHref("/register", nextPath);
  return (
    <div className="h-full overflow-y-auto bg-background">
      <AuthShell claimHeading>
        <section aria-labelledby="landing-access">
          <h2 id="landing-access" className="text-[clamp(1.75rem,4vw,2.25rem)] font-extrabold leading-none tracking-[-0.04em]">
            Einsteigen
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">Neue Konten gibt ein Admin frei.</p>
          <div className="mt-8 flex flex-col gap-3">
            <Link href={loginHref} className="action-primary min-h-12 w-full text-[15px]">
              Anmelden
            </Link>
            <Link href={registerHref} className="action-secondary min-h-12 w-full text-[15px]">
              Konto erstellen
            </Link>
          </div>
        </section>
      </AuthShell>
    </div>
  );
}

/** Shown to logged-in but not-yet-approved users. */
export function PendingScreen() {
  const me = useMe();
  const logout = useLogout();
  const [loggingOut, setLoggingOut] = useState(false);
  const name = me.data?.display_name;

  async function signOut() {
    setLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      toast.error(`Abmelden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      setLoggingOut(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <AuthShell compact>
        <section aria-labelledby="pending-title">
          <h1 id="pending-title" className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] [overflow-wrap:anywhere] [text-wrap:balance]">
            Fast geschafft{name ? `, ${name}` : ""}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">Ein Admin muss dein Konto noch freigeben.</p>
          <dl className="mt-8 border-t border-hairline">
            <div className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline">
              <dt className="label-mono">Konto</dt>
              <dd className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircleIcon width={16} height={16} aria-hidden className="shrink-0 text-success" />
                Angelegt
              </dd>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline">
              <dt className="label-mono">Freigabe</dt>
              <dd className="flex items-center gap-2 text-sm font-semibold">
                <ClockIcon width={16} height={16} aria-hidden className="shrink-0 text-muted" />
                Ausstehend
              </dd>
            </div>
          </dl>
          {me.isError && (
            <p role="alert" className="error-panel mt-5">
              Status konnte nicht geprüft werden: {me.error.message}
            </p>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => void me.refetch()} disabled={me.isFetching} aria-busy={me.isFetching} className="action-primary min-h-12 flex-1 text-[15px]">
              {me.isFetching && <SpinnerIcon width={18} height={18} aria-hidden className="animate-spin motion-reduce:animate-none" />}
              {me.isFetching ? "Wird geprüft…" : "Erneut prüfen"}
            </button>
            <button type="button" onClick={signOut} disabled={loggingOut} className="action-secondary min-h-12 flex-1 text-[15px]">
              {loggingOut ? "Wird abgemeldet…" : "Abmelden"}
            </button>
          </div>
        </section>
      </AuthShell>
    </div>
  );
}
