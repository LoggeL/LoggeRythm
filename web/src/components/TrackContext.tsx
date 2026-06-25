"use client";

import { useState } from "react";
import type { Track } from "@/types";
import { useTrackMenuItems } from "@/components/TrackMenu";
import ContextMenu from "@/components/ContextMenu";

/**
 * Wraps children with a right-click track context menu. Rendered per-track,
 * so the useTrackMenuItems hook is always called for a concrete track.
 */
export default function TrackContext({
  track,
  onRemove,
  children,
  className,
}: {
  track: Track;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const items = useTrackMenuItems(track, onRemove);
  return (
    <div
      className={className}
      onContextMenu={(e) => {
        e.preventDefault();
        setPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {pos && (
        <ContextMenu
          x={pos.x}
          y={pos.y}
          items={items}
          onClose={() => setPos(null)}
        />
      )}
    </div>
  );
}
