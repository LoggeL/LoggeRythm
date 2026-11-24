"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { PasswordField, SubmitButton, TextField, emailError } from "@/components/AuthFields";
import { buildAuthHref, sanitizeNextPath } from "@/lib/authRedirect";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";

type FieldErrors = { email: string | null; password: string | null };
const NO_ERRORS: FieldErrors = { email: null, password: null };

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const invalid: FieldErrors = { email: emailError(email), password: password ? null : "Bitte gib dein Passwort ein." };
    setFieldErrors(invalid);
    setError(null);
    if (invalid.email || invalid.password) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const user = await api.login(email, password);
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
      eyebrow="Anmeldung"
      title="Willkommen zurück"
      subtitle="Melde dich an und hör dort weiter, wo du aufgehört hast."
      footer={
        <>
          <span>Noch kein Konto?</span>
          <Link href={buildAuthHref("/register", nextPath)} className="action-secondary min-h-11">
            Registrieren
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate aria-busy={loading} className="flex flex-col gap-5">
        <TextField
          label="E-Mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          disabled={loading}
          required
          value={email}
          error={fieldErrors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((current) => ({ ...current, email: null }));
          }}
        />
        <PasswordField
          label="Passwort"
          hint={
            <Link href="/forgot-password" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Passwort vergessen?
            </Link>
          }
          name="password"
          autoComplete="current-password"
          enterKeyHint="go"
          disabled={loading}
          required
          value={password}
          error={fieldErrors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((current) => ({ ...current, password: null }));
          }}
        />
        {error && (
          <p role="alert" className="error-panel">
            Anmeldung fehlgeschlagen: {error}
          </p>
        )}
        <SubmitButton loading={loading} loadingLabel="Wird angemeldet…">
          Anmelden
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
