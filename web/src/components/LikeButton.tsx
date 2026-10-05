"use client";

import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import { useLikedIds, useLikePending, useToggleLike } from "@/hooks/useLibrary";
import { HeartIcon } from "@/components/icons";

export default function LikeButton({ track }: { track: Track }) {
  const router = useRouter();
  const { data: me } = useMe();
  const liked = useLikedIds(!!me).has(String(track.id));
  const toggleLike = useToggleLike(track.id);
  const pending = useLikePending(track.id) || toggleLike.isPending;

  return (
    <button
      type="button"
      onClick={() => {
        if (!me) { router.push("/login"); return; }
        if (!pending) toggleLike.mutate({ track, liked });
      }}
      disabled={pending}
      aria-label="Gefällt mir"
      aria-pressed={liked}
      aria-busy={pending}
      title={liked ? "Like entfernen" : "Liken"}
      className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full transition hover:bg-panel-hover disabled:opacity-50 ${liked ? "text-accent-soft" : "text-muted hover:text-foreground"}`}
    >
      <HeartIcon filled={liked} />
    </button>
  );
}
