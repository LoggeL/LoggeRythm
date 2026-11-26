"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { SubmitButton, TextField, emailError } from "@/components/AuthFields";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const invalid = emailError(email);
    setFieldError(invalid);
    setError(null);
    if (invalid) return;
    inFlight.current = true;
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Passwort vergessen?"
      subtitle="Wir schicken dir einen Link, mit dem du ein neues Passwort setzen kannst."
      footer={
        <>
          <span>Doch wieder eingefallen?</span>
          <Link href="/login" className="action-secondary min-h-11">
            Anmelden
          </Link>
        </>
      }
    >
      {sentTo ? (
        <p role="status" className="text-sm leading-relaxed">
          Falls es zu <strong className="[overflow-wrap:anywhere]">{sentTo}</strong> ein Konto gibt, ist jetzt eine Mail mit
          einem Link unterwegs. Er gilt 60 Minuten. Schau auch im Spam-Ordner nach.
        </p>
      ) : (
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
            error={fieldError}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldError(null);
            }}
          />
          {error && (
            <p role="alert" className="error-panel">
              Link konnte nicht verschickt werden: {error}
            </p>
          )}
          <SubmitButton loading={loading} loadingLabel="Wird verschickt…">
            Link anfordern
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
