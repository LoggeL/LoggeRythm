"use client";

import { useToastStore } from "@/store/toast";

const STYLES: Record<string, string> = {
  success: "border-accent/60 bg-[#1f1a2e]",
  error: "border-red-500/60 bg-[#2a1717]",
  info: "border-white/20 bg-panel-hover",
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(92vw,24rem)]">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`text-left text-sm px-4 py-3 rounded-lg border shadow-xl text-foreground animate-[fadeIn_0.15s_ease-out] ${
            STYLES[t.kind] ?? STYLES.info
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
