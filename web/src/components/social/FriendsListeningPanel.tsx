"use client";

import Link from "next/link";
import { useSocialActivity } from "@/hooks/useSocialActivity";
import { usePlayerStore } from "@/store/player";
import { trackArtistLabel } from "@/lib/trackArtists";
import Avatar from "@/components/Avatar";
import EqualizerBars from "@/components/EqualizerBars";
import Cover from "@/components/ui/Cover";
import SectionHeader from "@/components/ui/SectionHeader";
import { PlayIcon, UsersIcon } from "@/components/icons";

/**
 * Live "Friends Listening Now" strip (`GET /api/social/activity` + SSE).
 * Renders active friends who opted into `share_listening_activity` with instant
 * track playback and a 1-click "Jam beitreten" CTA when a Jam is active.
 */
export default function FriendsListeningPanel() {
  const { items, isError, error, streamError, refetch } = useSocialActivity(true);
  const playTrack = usePlayerStore((s) => s.playTrack);

  if (!isError && !streamError && items.length === 0) return null;

  return (
    <section aria-labelledby="friends-listening-heading">
      <SectionHeader
        id="friends-listening-heading"
        title="Freunde hören gerade"
        description="Live-Aktivität auf diesem Server"
        href="/account?tab=profile"
        linkLabel="Privatsphäre"
      />
      {(isError || streamError) && (
        <div role="alert" className="error-panel mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            Freunde-Aktivität konnte nicht geladen werden:{" "}
            {error instanceof Error ? error.message : streamError ?? String(error)}
          </span>
          <button type="button" onClick={() => void refetch()} className="action-secondary min-h-8 px-3 text-xs">
            Erneut versuchen
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.user_id}
              className="flex min-w-0 flex-col justify-between gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel/65 p-3.5 transition-colors hover:border-border"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Link
                  href={`/users/${encodeURIComponent(String(item.user_id))}`}
                  className="flex min-w-0 items-center gap-2.5 hover:underline"
                >
                  <Avatar src={item.avatar_url} name={item.display_name} size={30} />
                  <span className="truncate text-sm font-semibold text-foreground">{item.display_name}</span>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  <EqualizerBars height={12} isPlaying={item.is_playing} />
                  {item.device_name && (
                    <span className="label-mono max-w-[7rem] truncate text-[10px]">{item.device_name}</span>
                  )}
                </div>
              </div>

              {item.track ? (
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => playTrack(item.track!)}
                    aria-label={`${item.track.title} abspielen`}
                    className="group relative shrink-0 overflow-hidden rounded-art"
                  >
                    <Cover src={item.track.cover} className="h-11 w-11 rounded-art" />
                    <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <PlayIcon width={16} height={16} className="text-white" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.track.title}</p>
                    <p className="truncate text-xs text-muted">{trackArtistLabel(item.track)}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">Online</p>
              )}

              {item.party_code && (
                <Link
                  href={`/party/${encodeURIComponent(item.party_code)}`}
                  className="action-primary min-h-9 w-full justify-center gap-2 text-xs"
                >
                  <UsersIcon width={14} height={14} />
                  Jam beitreten ({item.party_code})
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
