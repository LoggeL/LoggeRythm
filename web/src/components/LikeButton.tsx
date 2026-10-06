"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import { useLikedIds, useLikePending, useToggleLike } from "@/hooks/useLibrary";
import { HeartIcon } from "@/components/icons";
import { LIKE_BURST_DURATION, getLikeBurstGeometry, type LikeBurstGeometry } from "./LikeButton.motion";
import styles from "./LikeButton.module.css";

type Celebration = LikeBurstGeometry & { id: number; trackId: string };

function LikeCelebration({ burst }: { burst: Celebration }) {
  return createPortal(
    <div aria-hidden="true" className={styles.celebration} data-like-celebration="true">
      {burst.surface && (
        <span
          className={styles.surface}
          style={{
            left: burst.surface.left,
            top: burst.surface.top,
            width: burst.surface.width,
            height: burst.surface.height,
            "--origin-x": `${burst.x - burst.surface.left}px`,
            "--origin-y": `${burst.y - burst.surface.top}px`,
          } as CSSProperties}
        />
      )}
      <span className={styles.origin} style={{ left: burst.x, top: burst.y }}>
        <span className={styles.bloom} />
        <span className={styles.flash} />
        <span className={`${styles.ring} ${styles.ringInner}`} />
        <span className={`${styles.ring} ${styles.ringMiddle}`} />
        <span className={`${styles.ring} ${styles.ringOuter}`} />
        {burst.particles.map((particle, index) => (
          <span
            key={index}
            className={`${styles.particle} ${particle.kind === "heart" ? styles.particleHeart : styles.particleSpark}`}
            style={{
              "--flight-x": `${particle.x}px`,
              "--flight-y": `${particle.y}px`,
              "--flight-rotation": `${particle.rotation}deg`,
              "--flight-delay": `${particle.delay}ms`,
              "--flight-size": `${particle.size}px`,
              "--flight-color": particle.color,
            } as CSSProperties}
          >
            {particle.kind === "heart" && <HeartIcon filled strokeWidth={0} width="100%" height="100%" />}
          </span>
        ))}
        <span className={styles.heartEcho}>
          <HeartIcon filled strokeWidth={0} width={44} height={44} />
        </span>
        <span className={styles.motionlessFeedback}>
          <HeartIcon filled strokeWidth={0} width={26} height={26} />
        </span>
      </span>
    </div>,
    document.body,
  );
}

export default function LikeButton({ track }: { track: Track }) {
  const router = useRouter();
  const { data: me } = useMe();
  const trackId = String(track.id);
  const liked = useLikedIds(!!me).has(trackId);
  const toggleLike = useToggleLike(track.id);
  const pending = useLikePending(track.id) || toggleLike.isPending;
  const gradientId = useId();
  const request = useRef<symbol | null>(null);
  const sequence = useRef(0);
  const [animation, setAnimation] = useState<{ owner: string; celebration: Celebration | null }>({ owner: trackId, celebration: null });
  const burst = animation.owner === trackId ? animation.celebration : null;
  // Reset ownership when this instance changes songs, including A → B → A.
  // Merely hiding a mismatched burst would retain it after cancelling its timer.
  if (animation.owner !== trackId) setAnimation({ owner: trackId, celebration: null });

  // Per-call mutation callbacks can outlive a song surface. Invalidating their
  // identity prevents a late save from launching an effect on a different song.
  useEffect(() => () => { request.current = null; }, [trackId]);

  useEffect(() => {
    if (!burst) return;
    const clear = () => setAnimation((current) => ({ ...current, celebration: null }));
    const onVisibility = () => { if (document.hidden) clear(); };
    const timer = window.setTimeout(clear, LIKE_BURST_DURATION);
    // A fixed portal escapes scroll-container clipping, but must not remain
    // floating at its former coordinates when its source moves.
    document.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [burst]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!me) { router.push("/login"); return; }
    if (pending || request.current) return;
    const button = event.currentTarget;
    const operation = Symbol("like operation");
    request.current = operation;
    setAnimation({ owner: trackId, celebration: null });
    toggleLike.mutate({ track, liked }, {
      onSuccess: () => {
        // Optimistic cache updates still provide immediate heart feedback. The
        // large celebration is reserved for a like the server actually saved.
        if (liked || request.current !== operation || !button.isConnected) return;
        const geometry = getLikeBurstGeometry(button, window.innerWidth, window.innerHeight);
        setAnimation({ owner: trackId, celebration: { ...geometry, id: ++sequence.current, trackId } });
      },
      onSettled: () => {
        if (request.current === operation) request.current = null;
      },
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label="Gefällt mir"
        aria-pressed={liked}
        aria-busy={pending}
        title={liked ? "Like entfernen" : "Liken"}
        className={`${styles.button} ${liked ? styles.liked : ""} ${burst ? styles.celebrating : ""}`}
      >
        <svg width={0} height={0} className={styles.gradient} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff84cc" />
              <stop offset="55%" stopColor="#ed64bd" />
              <stop offset="100%" stopColor="#9d7bff" />
            </linearGradient>
          </defs>
        </svg>
        <HeartIcon
          key={burst?.id ?? "rest"}
          filled={liked}
          className={styles.heart}
          {...(liked ? { fill: `url(#${gradientId})`, stroke: "#ef81d0", strokeWidth: 1.2 } : {})}
        />
      </button>
      {burst && <LikeCelebration key={burst.id} burst={burst} />}
    </>
  );
}
