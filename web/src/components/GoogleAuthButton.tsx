"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildGoogleAuthStartHref, type GoogleAuthOrigin } from "@/lib/googleAuth";

const LABELS = {
  login: "Mit Google anmelden",
  register: "Mit Google registrieren",
  continue: "Mit Google fortfahren",
} as const;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function GoogleAuthButton({
  mode,
  origin,
  nextPath,
  invite,
  disabled = false,
  showDivider = true,
}: {
  mode: keyof typeof LABELS;
  origin: GoogleAuthOrigin;
  nextPath?: string | null;
  invite?: string | null;
  disabled?: boolean;
  showDivider?: boolean;
}) {
  const { data, isError, error } = useQuery({
    queryKey: ["auth-providers"],
    queryFn: api.authProviders,
    staleTime: 60_000,
    retry: false,
  });

  if (isError) {
    return (
      <p role="alert" className="error-panel mt-4">
        Google-Anmeldung konnte nicht geprüft werden: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data?.google) return null;

  const href = buildGoogleAuthStartHref({ origin, nextPath, invite });

  return (
    <>
      {showDivider && (
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-subtle">
          <span className="h-px flex-1 bg-hairline" />
          <span>oder</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      )}
      <a
        href={href}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        className={`action-secondary min-h-12 w-full text-[15px] ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <GoogleMark />
        {LABELS[mode]}
      </a>
    </>
  );
}
