"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { shouldRemoveQueryForUserChange } from "@/lib/queryPersistence";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const user = await api.login(email, password);
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
          : "Anmeldung fehlgeschlagen.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Anmelden">
      <form onSubmit={submit} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            disabled={loading}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
        </label>
        {error && <p role="alert" className="error-panel">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="action-primary mt-2 w-full"
        >
          {loading ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
      <p className="text-sm text-muted text-center mt-6">
        Noch kein Konto?{" "}
        <Link href="/register" className="text-accent hover:underline">
          Registrieren
        </Link>
      </p>
    </AuthCard>
  );
}
