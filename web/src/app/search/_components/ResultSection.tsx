import type { ReactNode } from "react";

/**
 * One result type. The heading (and the jump to that type's full list) only
 * shows in the combined view; a single-type view is already named by its chip.
 */
export default function ResultSection({
  label,
  heading,
  onShowAll,
  className = "",
  children,
}: {
  label: string;
  heading: boolean;
  onShowAll?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={`min-w-0 ${className}`}>
      {heading && (
        <div className="section-heading">
          <h2>{label}</h2>
          {onShowAll && (
            <button type="button" className="section-link max-sm:min-h-11" aria-label={`Alle ${label} anzeigen`} onClick={onShowAll}>
              Alle anzeigen
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
