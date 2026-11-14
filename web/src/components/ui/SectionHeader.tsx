import Link from "next/link";
import type { ReactNode } from "react";

/** Section title row with an optional description and a trailing link/action. */
export default function SectionHeader({
  id,
  title,
  description,
  href,
  linkLabel,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="min-w-0">
        <h2 id={id}>{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {href && linkLabel ? (
        <Link href={href} className="section-link">
          {linkLabel}
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
