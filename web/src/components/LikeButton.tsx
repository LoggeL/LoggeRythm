"use client";

import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import { useLikedIds, useToggleLike } from "@/hooks/useLibrary";
import { HeartIcon } from "@/components/icons";

export default function LikeButton({ track }: { track: Track }) {
  const router = useRouter();
  const { data: me } = useMe();
  const likedIds = useLikedIds(!!me);
  const toggleLike = useToggleLike();

  const liked = likedIds.has(String(track.id));

  function handle() {
    if (!me) {
      router.push("/login");
      return;
    }
    toggleLike.mutate({ track, liked });
  }

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={liked ? "Like entfernen" : "Liken"}
      title={liked ? "Like entfernen" : "Liken"}
      className={`p-1 rounded-full hover:bg-panel-hover transition ${
        liked ? "text-accent" : "text-muted hover:text-foreground"
      }`}
    >
      <HeartIcon filled={liked} />
    </button>
  );
}
