import { sanitizeNextPath } from "./authRedirect";

export type GoogleAuthOrigin = "/login" | "/register";

export function buildGoogleAuthStartHref({
  origin,
  nextPath,
  invite,
}: {
  origin: GoogleAuthOrigin;
  nextPath?: string | null;
  invite?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("origin", origin);
  const safeNext = sanitizeNextPath(nextPath);
  if (safeNext && safeNext !== "/") {
    params.set("next", safeNext);
  }
  const trimmedInvite = invite?.trim();
  if (trimmedInvite) {
    params.set("invite", trimmedInvite);
  }
  return `/api/auth/google/start?${params.toString()}`;
}

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Die Google-Anmeldung wurde abgebrochen.",
  invalid_state: "Die Google-Anmeldesitzung ist abgelaufen oder ungültig. Bitte versuche es erneut.",
  invalid_invite: "Der Einladungscode ist ungültig oder wurde bereits verwendet.",
  google_email_unverified: "Die E-Mail-Adresse deines Google-Kontos ist nicht verifiziert.",
  google_account_conflict: "Diese E-Mail-Adresse ist bereits mit einem anderen Google-Konto verknüpft.",
  google_exchange_failed: "Der Anmeldecode konnte bei Google nicht eingelöst werden. Bitte versuche es erneut.",
  google_invalid_token: "Die Antwort von Google konnte nicht verifiziert werden. Bitte versuche es erneut.",
  google_auth_failed: "Google konnte die Anmeldung nicht abschließen.",
  not_configured: "Die Google-Anmeldung ist auf diesem Server nicht eingerichtet.",
};

export function googleOAuthErrorMessage(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  return GOOGLE_ERROR_MESSAGES[trimmed] ?? `Google-Anmeldung fehlgeschlagen (${trimmed}).`;
}
