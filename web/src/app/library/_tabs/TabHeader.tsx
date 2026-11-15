import type { ReactNode } from "react";

/** Title row of a library tab: heading, a short count or hint, and actions. */
export default function TabHeader({ id, title, meta, children }: { id: string; title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="section-heading flex-wrap">
      <div className="min-w-0">
        <h2 id={id}>{title}</h2>
        {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
      </div>
      {children}
    </div>
  );
}
