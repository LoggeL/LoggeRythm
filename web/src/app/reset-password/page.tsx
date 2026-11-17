"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { PasswordField, SubmitButton } from "@/components/AuthFields";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";

type FieldErrors = { password: string | null; confirm: string | null };
const NO_ERRORS: FieldErrors = { password: null, confirm: null };

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = use(searchParams);
  const resetToken = typeof token === "string" ? token.trim() : "";

  if (!resetToken) {
    return (
      <AuthCard
        eyebrow="Passwort"
        title="Link unvollständig"
        footer={
          <Link href="/forgot-password" className="action-secondary min-h-11">
            Neuen Link anfordern
          </Link>
        }
      >
        <p role="alert" className="error-panel">
          Diesem Link fehlt der Code zum Zurücksetzen. Öffne den Link aus der Mail noch einmal vollständig oder fordere einen neuen an.
        </p>
      </AuthCard>
    );
  }
  return <ResetPasswordForm token={resetToken} />;
}

function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const invalid: FieldErrors = {
      password: password.length < 8 ? "Das Passwort braucht mindestens 8 Zeichen." : null,
      confirm: confirm !== password ? "Die Passwörter stimmen nicht überein." : null,
    };
    setFieldErrors(invalid);
    setError(null);
    if (invalid.password || invalid.confirm) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const user = await api.resetPassword(token, password);
      qc.removeQueries({ predicate: (query) => shouldRemoveQueryForUserChange(query.queryKey, String(user.id)) });
      qc.setQueryData(["me"], user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthCard
      eyebrow="Passwort"
      title="Neues Passwort setzen"
      subtitle="Danach bist du direkt angemeldet."
      footer={
        <Link href="/forgot-password" className="action-secondary min-h-11">
          Neuen Link anfordern
        </Link>
      }
    >
      <form onSubmit={submit} noValidate aria-busy={loading} className="flex flex-col gap-5">
        <PasswordField
          label="Neues Passwort"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          minLength={8}
          maxLength={128}
          disabled={loading}
          required
          value={password}
          error={fieldErrors.password}
          hint="Mindestens 8 Zeichen."
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((current) => ({ ...current, password: null }));
          }}
        />
        <PasswordField
          label="Passwort wiederholen"
          name="confirm-password"
          autoComplete="new-password"
          enterKeyHint="go"
          maxLength={128}
          disabled={loading}
          required
          value={confirm}
          error={fieldErrors.confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setFieldErrors((current) => ({ ...current, confirm: null }));
          }}
        />
        {error && (
          <p role="alert" className="error-panel">
            Passwort konnte nicht gesetzt werden: {error}
          </p>
        )}
        <SubmitButton loading={loading} loadingLabel="Wird gespeichert…">
          Passwort speichern
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
