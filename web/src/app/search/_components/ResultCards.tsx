import type { ReactNode } from "react";
import Shelf, { ShelfSkeleton } from "@/components/browse/Shelf";
import { CardGridSkeleton } from "@/components/Skeleton";

export type ResultLayout = "shelf" | "grid";

/** Cards as one scrolling row (combined view) or as the full grid (one type). */
export default function ResultCards({
  label,
  layout,
  loading = false,
  round = false,
  children,
}: {
  label: string;
  layout: ResultLayout;
  loading?: boolean;
  round?: boolean;
  children?: ReactNode;
}) {
  if (loading) return layout === "shelf" ? <ShelfSkeleton round={round} /> : <CardGridSkeleton count={10} />;
  if (layout === "shelf") return <Shelf label={label}>{children}</Shelf>;
  return <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</div>;
}
