"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertCircleIcon, EyeIcon, EyeOffIcon } from "@/components/feedbackIcons";
import { SpinnerIcon } from "@/components/icons";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
  label: string;
  /** Validation message shown under the field; also marks it invalid. */
  error?: string | null;
  hint?: ReactNode;
};

function FieldFrame({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label-mono">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-[13px] leading-snug text-danger">
          <AlertCircleIcon width={15} height={15} aria-hidden className="mt-px shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const describedBy = (id: string, error?: string | null, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);
const inputClass = (error?: string | null) => `field-input min-h-12 text-base ${error ? "border-danger/70 hover:border-danger/70 focus:border-danger" : ""}`;

/** Labelled text input with an inline error or hint. */
export function TextField({ label, error, hint, ...input }: FieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      <input {...input} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} className={inputClass(error)} />
    </FieldFrame>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({ label, error, hint, ...input }: Omit<FieldProps, "type">) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={`${inputClass(error)} pr-13`}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
          aria-pressed={visible}
          className="action-icon absolute right-0.5 top-1/2 h-11 w-11 -translate-y-1/2 aria-pressed:text-foreground"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </FieldFrame>
  );
}

/** Full-width submit button that shows a spinner while the request runs. */
export function SubmitButton({ loading, loadingLabel, children }: { loading: boolean; loadingLabel: string; children: ReactNode }) {
  return (
    <button type="submit" disabled={loading} aria-busy={loading} className="action-primary mt-3 min-h-12 w-full text-[15px] disabled:opacity-70">
      {loading && <SpinnerIcon width={18} height={18} aria-hidden className="animate-spin motion-reduce:animate-none" />}
      {loading ? loadingLabel : children}
    </button>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the German validation message for an email input, or null if valid. */
export function emailError(value: string): string | null {
  if (!value.trim()) return "Bitte gib deine E-Mail-Adresse ein.";
  if (!EMAIL_PATTERN.test(value.trim())) return "Das sieht nicht nach einer E-Mail-Adresse aus.";
  return null;
}
