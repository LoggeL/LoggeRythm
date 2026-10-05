import type { ReactNode } from "react";
import Link from "next/link";
import Logo, { Wordmark } from "@/components/Logo";

export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <section className="surface-card w-full max-w-md p-7 sm:p-9" aria-labelledby="auth-title">
        <Link href="/" className="mb-8 flex w-fit items-center gap-3"><Logo size={32} /><Wordmark /></Link>
        <h1 id="auth-title" className="mb-7 text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </section>
    </div>
  );
}
