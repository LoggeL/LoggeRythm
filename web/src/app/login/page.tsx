"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api.login(email, password);
      qc.setQueryData(["me"], user);
      qc.invalidateQueries({ queryKey: ["likes"] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      router.push("/");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Anmeldung fehlgeschlagen.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-8 bg-panel rounded-lg p-8">
      <h1 className="text-2xl font-extrabold mb-6 text-center">
        Bei Spotifrei anmelden
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          E-Mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Passwort
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-2 px-4 py-2.5 rounded-full play-ring text-white font-semibold disabled:opacity-50"
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
    </div>
  );
}
