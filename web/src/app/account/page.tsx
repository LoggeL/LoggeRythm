"use client";

import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe, useLogout } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/store/toast";
import type { AdminUser } from "@/types";

function StatusBadge({ approved }: { approved: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        approved
          ? "bg-accent text-white"
          : "bg-panel-hover text-muted"
      }`}
    >
      {approved ? "Freigegeben" : "Wartet auf Freigabe"}
    </span>
  );
}

function AdminUsersSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: api.adminUsers,
  });

  const approve = useMutation({
    mutationFn: (id: string | number) => api.approveUser(id),
    onSuccess: () => {
      toast.success("Benutzer freigegeben.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Freigabe fehlgeschlagen.",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string | number) => api.deleteUser(id),
    onSuccess: () => {
      toast.success("Benutzer entfernt.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Entfernen fehlgeschlagen.",
      ),
  });

  function handleDelete(u: AdminUser) {
    if (
      !window.confirm(
        `Benutzer ${u.display_name} (${u.email}) wirklich entfernen?`,
      )
    )
      return;
    remove.mutate(u.id);
  }

  return (
    <section className="bg-panel rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Benutzerverwaltung</h2>

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Benutzer konnten nicht geladen werden."}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-muted">Keine Benutzer vorhanden.</p>
      )}

      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((u) => (
            <li
              key={String(u.id)}
              className="flex flex-wrap items-center gap-3 bg-background rounded-md px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {u.display_name}
                  </span>
                  {u.is_admin && (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-white">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted truncate">{u.email}</div>
              </div>

              <StatusBadge approved={u.is_approved} />

              <div className="flex items-center gap-2">
                {!u.is_approved && (
                  <button
                    type="button"
                    onClick={() => approve.mutate(u.id)}
                    disabled={approve.isPending}
                    className="press px-3 py-1.5 rounded-full text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    Freigeben
                  </button>
                )}
                {!u.is_admin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(u)}
                    disabled={remove.isPending}
                    className="press px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10 disabled:opacity-50"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AccountPage() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();

  if (isLoading) {
    return <p className="text-muted">Lädt…</p>;
  }

  if (!me) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-extrabold mb-3">Dein Konto</h1>
        <p className="text-muted mb-4">
          Melde dich an, um dein Konto zu verwalten.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          Anmelden
        </Link>
      </div>
    );
  }

  const initial = (me.display_name || me.email || "?").charAt(0).toUpperCase();

  return (
    <div className="animate-in flex flex-col gap-8 max-w-3xl">
      <section className="bg-panel rounded-lg p-6 flex items-center gap-5">
        <div className="w-20 h-20 flex-shrink-0 rounded-full bg-accent text-white flex items-center justify-center text-3xl font-extrabold">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-extrabold truncate">
              {me.display_name}
            </h1>
            {me.is_admin && (
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-white">
                Admin
              </span>
            )}
          </div>
          <p className="text-muted truncate">{me.email}</p>
          <div className="mt-2">
            <StatusBadge approved={!!me.is_approved} />
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="press self-start px-4 py-2 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10"
        >
          Logout
        </button>
      </section>

      {me.is_admin && <AdminUsersSection />}
    </div>
  );
}
