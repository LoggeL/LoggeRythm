"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";

function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setLoading(true);
    try {
      const user = await api.register(
        email,
        password,
        displayName,
        invite ?? undefined,
      );
      qc.removeQueries({
        predicate: (query) =>
          shouldRemoveQueryForUserChange(query.queryKey, String(user.id)),
      });
      qc.setQueryData(["me"], user);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Registrierung fehlgeschlagen.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Konto erstellen">
      {invite && (
        <p className="text-sm text-muted text-center mb-4">
          Mit Einladung – wird automatisch freigegeben.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Anzeigename
          <input
            type="text"
            autoComplete="nickname"
            maxLength={120}
            disabled={loading}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="field-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          E-Mail
          <input
            type="email"
            autoComplete="email"
            disabled={loading}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Passwort
          <input
            type="password"
            autoComplete="new-password"
            disabled={loading}
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
          <span className="text-xs text-muted">Mindestens 8 Zeichen.</span>
        </label>
        {error && <p role="alert" className="error-panel">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="action-primary mt-2 w-full"
        >
          {loading ? "Erstellen…" : "Registrieren"}
        </button>
      </form>
      <p className="text-sm text-muted text-center mt-6">
        Bereits ein Konto?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Anmelden
        </Link>
      </p>
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
