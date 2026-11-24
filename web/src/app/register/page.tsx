"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { PasswordField, SubmitButton, TextField, emailError } from "@/components/AuthFields";
import { CheckCircleIcon } from "@/components/feedbackIcons";
import { buildAuthHref, sanitizeNextPath } from "@/lib/authRedirect";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";

const PASSWORD_MIN = 8;
type FieldErrors = { displayName: string | null; email: string | null; password: string | null };
const NO_ERRORS: FieldErrors = { displayName: null, email: null, password: null };

function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const clearError = (field: keyof FieldErrors) => setFieldErrors((current) => ({ ...current, [field]: null }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const invalid: FieldErrors = {
      displayName: displayName.trim() ? null : "Bitte gib einen Anzeigenamen ein.",
      email: emailError(email),
      password: password.length >= PASSWORD_MIN ? null : `Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`,
    };
    setFieldErrors(invalid);
    setError(null);
    if (invalid.displayName || invalid.email || invalid.password) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const user = await api.register(email, password, displayName, invite ?? undefined);
      qc.removeQueries({ predicate: (query) => shouldRemoveQueryForUserChange(query.queryKey, String(user.id)) });
      qc.setQueryData(["me"], user);
      router.push(nextPath ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthCard
      eyebrow={invite ? "Registrierung · Einladung" : "Registrierung"}
      title="Konto erstellen"
      subtitle={invite ? undefined : "Nach der Registrierung gibt ein Admin dein Konto frei."}
      footer={
        <>
          <span>Bereits ein Konto?</span>
          <Link href={buildAuthHref("/login", nextPath)} className="action-secondary min-h-11">
            Anmelden
          </Link>
        </>
      }
    >
      {invite && (
        <p className="mb-7 flex items-start gap-2.5 border-l-2 border-success pl-3.5 text-sm leading-relaxed">
          <CheckCircleIcon aria-hidden className="mt-0.5 shrink-0 text-success" />
          Du wurdest eingeladen – dein Konto ist sofort freigeschaltet.
        </p>
      )}
      <form onSubmit={submit} noValidate aria-busy={loading} className="flex flex-col gap-5">
        <TextField
          label="Anzeigename"
          type="text"
          name="display_name"
          autoComplete="nickname"
          maxLength={120}
          autoFocus
          disabled={loading}
          required
          value={displayName}
          error={fieldErrors.displayName}
          hint="So sehen dich andere, z. B. in Partys."
          onChange={(e) => {
            setDisplayName(e.target.value);
            clearError("displayName");
          }}
        />
        <TextField
          label="E-Mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          required
          value={email}
          error={fieldErrors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
          }}
        />
        <PasswordField
          label="Passwort"
          name="password"
          autoComplete="new-password"
          enterKeyHint="go"
          disabled={loading}
          required
          minLength={PASSWORD_MIN}
          maxLength={128}
          value={password}
          error={fieldErrors.password}
          hint={`Mindestens ${PASSWORD_MIN} Zeichen.`}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError("password");
          }}
        />
        {error && (
          <p role="alert" className="error-panel">
            Registrierung fehlgeschlagen: {error}
          </p>
        )}
        <SubmitButton loading={loading} loadingLabel="Konto wird erstellt…">
          Registrieren
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
