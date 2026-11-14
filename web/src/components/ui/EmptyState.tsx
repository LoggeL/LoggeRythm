import type { ReactNode } from "react";

/** Centered placeholder for a section that has nothing to show yet. */
export default function EmptyState({
  icon,
  title,
  children,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`empty-panel ${className}`}>
      {icon && <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/[0.06] text-muted">{icon}</span>}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-sm leading-relaxed">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
