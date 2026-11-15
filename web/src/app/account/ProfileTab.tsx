"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";
import { EyeIcon, EyeOffIcon } from "@/components/feedbackIcons";
import { EditIcon, UserIcon } from "@/components/icons";
import type { User } from "@/types";
import { errorMessage, SettingsCard, SettingsRow } from "./presentation";

const FORM_ID = "edit-profile-form";

function EditProfileDialog({ me, onClose }: { me: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ display_name: me.display_name ?? "", email: me.email, password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const displayName = form.display_name.trim();
  const email = form.email.trim();
  const emailError = email ? null : "Die E-Mail darf nicht leer sein.";
  const passwordError = form.password && form.password.length < 8 ? "Das Passwort braucht mindestens 8 Zeichen." : null;
  const changed = displayName !== (me.display_name ?? "") || email !== me.email || form.password !== "";

  const save = useMutation({
    mutationFn: () => {
      const patch: { display_name?: string; email?: string; password?: string } = {};
      if (displayName !== (me.display_name ?? "")) patch.display_name = displayName;
      if (email !== me.email) patch.email = email;
      if (form.password) patch.password = form.password;
      return api.updateMe(patch);
    },
    onSuccess: () => {
      toast.success("Profil aktualisiert.");
      qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Profil bearbeiten"
      description="Änderungen gelten sofort auf allen Geräten."
      footer={
        <>
          <button type="button" onClick={onClose} disabled={save.isPending} className="action-secondary">
            Abbrechen
          </button>
          <button type="submit" form={FORM_ID} disabled={save.isPending || !changed || !!emailError || !!passwordError} className="action-primary">
            {save.isPending ? "Speichert…" : "Speichern"}
          </button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (emailError || passwordError || !changed) return;
          save.mutate();
        }}
        className="flex flex-col gap-4 pt-1"
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Anzeigename
          <input
            data-dialog-autofocus
            autoComplete="nickname"
            maxLength={120}
            value={form.display_name}
            onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
            className="field-input font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          E-Mail
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? "edit-profile-email-error" : undefined}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            className="field-input font-normal"
          />
          {emailError && (
            <span id="edit-profile-email-error" className="text-xs font-normal text-danger">
              {emailError}
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1.5 text-sm font-medium">
          <label htmlFor="edit-profile-password">Neues Passwort</label>
          <div className="relative">
            <input
              id="edit-profile-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={form.password}
              minLength={8}
              maxLength={128}
              aria-invalid={!!passwordError}
              aria-describedby="edit-profile-password-hint"
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              className="field-input pr-12 font-normal"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
              aria-pressed={showPassword}
              className="action-icon absolute right-0.5 top-1/2 h-10 min-h-10 w-10 -translate-y-1/2"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <span id="edit-profile-password-hint" className={`text-xs font-normal ${passwordError ? "text-danger" : "text-muted"}`}>
            {passwordError ?? "Leer lassen, um dein Passwort zu behalten."}
          </span>
        </div>
        {save.error && (
          <p role="alert" className="error-panel">
            Speichern fehlgeschlagen: {errorMessage(save.error)}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** "Profil" tab: personal data, session and account deletion. */
export default function ProfileTab({ me }: { me: User }) {
  const logout = useLogout();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const signOut = useMutation({
    mutationFn: logout,
    onError: (err) => toast.error(`Abmelden fehlgeschlagen: ${errorMessage(err)}`),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.deleteMe(),
    onSuccess: () => {
      toast.success("Konto gelöscht.");
      qc.clear();
      // Reload the document to dispose playback and in-memory account state.
      window.location.replace(new URL("/", window.location.origin).href);
    },
    onError: (err) => toast.error(`Konto konnte nicht gelöscht werden: ${errorMessage(err)}`),
  });

  return (
    <div className="grid gap-4">
      {editing && <EditProfileDialog me={me} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={confirmingDelete}
        title="Konto endgültig löschen?"
        confirmLabel="Endgültig löschen"
        destructive
        busy={deleteAccount.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => deleteAccount.mutate()}
      >
        Dein Konto wird mit allen Playlists, Likes und deinem Hörverlauf gelöscht. Das kann nicht rückgängig gemacht werden.
      </ConfirmDialog>

      <SettingsCard
        title="Persönliche Daten"
        description="So erscheinst du in LoggeRythm und so meldest du dich an."
        icon={<UserIcon width={18} height={18} />}
        action={
          <button type="button" onClick={() => setEditing(true)} className="action-secondary">
            <EditIcon width={16} height={16} /> Bearbeiten
          </button>
        }
      >
        <SettingsRow label="Anzeigename" description="Für andere in Partys und geteilten Playlists sichtbar.">
          <span className="text-sm text-muted [overflow-wrap:anywhere]">{me.display_name || "Nicht gesetzt"}</span>
        </SettingsRow>
        <SettingsRow label="E-Mail" description="Dein Login.">
          <span className="text-sm text-muted [overflow-wrap:anywhere]">{me.email}</span>
        </SettingsRow>
        <SettingsRow label="Passwort" description="Mindestens 8 Zeichen.">
          <span aria-label="Passwort verborgen" className="text-sm tracking-widest text-muted">
            ••••••••
          </span>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Sitzung & Konto">
        <SettingsRow label="Abmelden" description="Beendet die Sitzung auf diesem Gerät.">
          <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending} className="action-secondary">
            {signOut.isPending ? "Wird abgemeldet…" : "Abmelden"}
          </button>
        </SettingsRow>
        <SettingsRow label="Konto löschen" description="Entfernt dein Konto und alle persönlichen Daten dauerhaft.">
          <button type="button" onClick={() => setConfirmingDelete(true)} className="action-secondary action-danger">
            Konto löschen…
          </button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
