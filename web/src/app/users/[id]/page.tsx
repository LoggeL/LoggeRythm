"use client";

import { use, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { useMe } from "@/hooks/useAuth";
import { toast } from "@/store/toast";
import ArtistCard from "@/components/ArtistCard";
import PlaylistCard from "@/components/PlaylistCard";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import { BlendIcon, SpinnerIcon } from "@/components/icons";
import { CARD_GRID } from "@/components/cardGrid";
import { CardGridSkeleton } from "@/components/Skeleton";
import Shelf from "@/components/browse/Shelf";
import { useCoverColors } from "@/hooks/useCoverColors";
import collection from "@/app/playlist/_components/collection.module.css";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import type { BlendResult, PublicProfile } from "@/types";

export default function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const profile = useQuery<PublicProfile>({
    queryKey: ["public-profile", id],
    queryFn: () => api.publicProfile(id),
    enabled: !!id,
  });

  return (
    <CollectionPageState query={profile} label="Die Profildaten" missing="Profil nicht gefunden" skeleton={<ProfileSkeleton />}>
      {(data) => <ProfileView profile={data} />}
    </CollectionPageState>
  );
}

const countFormatter = new Intl.NumberFormat("de-DE");

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse gap-1.5 border-l border-hairline px-3 py-1 first:border-l-0 first:pl-0 sm:px-7">
      <dt className="label-mono truncate">{label}</dt>
      <dd className="font-display text-[clamp(1.5rem,6.4vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] tabular-nums">{countFormatter.format(value)}</dd>
    </div>
  );
}

function FigureSkeleton() {
  return (
    <div className="flex min-w-0 flex-col-reverse gap-1.5 border-l border-hairline px-3 py-1 first:border-l-0 first:pl-0 sm:px-7">
      <div className="skeleton h-4 w-16 max-w-full rounded" />
      <div className="skeleton h-[clamp(1.5rem,6.4vw,2.75rem)] w-10 rounded" />
    </div>
  );
}

/** Loading placeholder with the geometry of the profile header and the playlist grid below it. */
function ProfileSkeleton() {
  return (
    <div>
      <div role="status" aria-label="Wird geladen" className="pb-9 pt-2">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-8">
          <div className="skeleton h-28 w-28 shrink-0 rounded-full sm:h-40 sm:w-40" />
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="skeleton mb-3 h-4 w-16 rounded" />
            <div className="page-title skeleton w-1/2 rounded-[var(--radius-card)]" aria-hidden="true">
              &nbsp;
            </div>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-3 border-y border-hairline py-4 sm:inline-grid sm:grid-cols-[repeat(3,auto)]">
          <FigureSkeleton />
          <FigureSkeleton />
          <FigureSkeleton />
        </div>
      </div>
      <div className="section-heading">
        <div className="skeleton h-7 w-48 rounded" />
      </div>
      <CardGridSkeleton count={6} grid={CARD_GRID} />
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="label-mono shrink-0 tabular-nums">{countFormatter.format(value)}</span>;
}

function ProfileView({ profile }: { profile: PublicProfile }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [blendResult, setBlendResult] = useState<BlendResult | null>(null);
  const playlists = profile.playlists ?? [];
  const artists = profile.top_artists ?? [];
  const name = profile.display_name || "Unbekannt";
  const totalTracks = playlists.reduce((sum, playlist) => sum + (playlist.track_count || 0), 0);
  const palette = useCoverColors(profile.avatar_url);
  const tint = palette ? ({ "--hero-tint": palette.rgb.join(" ") } as CSSProperties) : undefined;
  const canBlend = Boolean(me?.is_approved && String(me.id) !== String(profile.id));

  const createBlend = useMutation({
    mutationFn: () => api.playlistBlend(profile.id),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["playlists"] });
      setBlendResult(result);
    },
    onError: (cause) => {
      toast.error(
        `Blend konnte nicht erstellt werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    },
  });

  return (
    <>
      <header className="relative isolate pb-9 pt-2" style={tint}>
        <div className={collection.wash} data-tinted={palette !== null} aria-hidden="true" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-8">
          <div className="cover-shadow h-28 w-28 shrink-0 overflow-hidden rounded-full sm:h-40 sm:w-40">
            <Avatar src={profile.avatar_url} name={name} size={160} className="h-full! w-full!" />
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            <p className="page-eyebrow">Profil</p>
            <h1 className={`page-title ${name.trim().length > 18 ? "text-[clamp(1.75rem,4.2vw,3rem)] leading-none" : ""}`} title={name}>
              {name}
            </h1>
            {canBlend && (
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={createBlend.isPending}
                  onClick={() => createBlend.mutate()}
                  className="action-primary"
                >
                  {createBlend.isPending ? (
                    <SpinnerIcon width={16} height={16} className="animate-spin" />
                  ) : (
                    <BlendIcon width={18} height={18} />
                  )}
                  {createBlend.isPending ? "Blend wird erstellt…" : "Blend erstellen"}
                </button>
              </div>
            )}
          </div>
        </div>
        <dl aria-label="Kennzahlen" className="mt-8 grid grid-cols-3 border-y border-hairline py-4 sm:inline-grid sm:grid-cols-[repeat(3,auto)]">
          <Figure value={playlists.length} label="Playlists" />
          <Figure value={artists.length} label="Künstler" />
          <Figure value={totalTracks} label="Titel" />
        </dl>
      </header>

      <Modal
        open={blendResult !== null}
        onClose={() => setBlendResult(null)}
        title="Euer Taste Blend ist fertig"
        description={
          blendResult
            ? `Gemeinsame Playlist mit ${blendResult.other_user.display_name || name}`
            : undefined
        }
        footer={
          blendResult && (
            <>
              <button type="button" onClick={() => setBlendResult(null)} className="action-secondary">
                Schließen
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = playlistPath(blendResult.playlist);
                  setBlendResult(null);
                  router.push(target);
                }}
                className="action-primary"
              >
                Blend-Playlist öffnen
              </button>
            </>
          )
        }
      >
        {blendResult && (
          <div className="flex flex-col gap-5 pt-1">
            <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-accent/40 bg-accent/10 px-4 py-4">
              <div>
                <p className="label-mono text-accent">Taste Match</p>
                <p className="font-display mt-1 text-4xl font-extrabold tracking-tight tabular-nums text-foreground">
                  {Math.round(blendResult.match_percent)} %
                </p>
              </div>
              <div className="text-right text-xs text-muted">
                <p className="font-semibold text-foreground">{blendResult.playlist.tracks.length} Titel im Blend</p>
                <p className="mt-0.5">{blendResult.shared_tracks_count} gemeinsame Favoriten</p>
              </div>
            </div>
            {blendResult.shared_artists.length > 0 && (
              <div>
                <p className="label-mono mb-2">Gemeinsame Künstler</p>
                <div className="flex flex-wrap gap-1.5">
                  {blendResult.shared_artists.map((artistName) => (
                    <span
                      key={artistName}
                      className="rounded-full border border-hairline bg-white/[0.04] px-3 py-1 text-xs font-medium text-foreground"
                    >
                      {artistName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <div className="flex flex-col gap-9 md:gap-11">
        <section aria-labelledby="profile-playlists">
          <SectionHeader id="profile-playlists" title="Öffentliche Playlists" action={playlists.length > 0 ? <Count value={playlists.length} /> : undefined} />
          {playlists.length === 0 ? (
            <EmptyState
              title="Keine öffentlichen Playlists"
              action={
                <Link href="/search" className="action-secondary">
                  Musik entdecken
                </Link>
              }
            />
          ) : (
            <div className={CARD_GRID}>
              {playlists.map((playlist) => (
                <PlaylistCard key={String(playlist.id)} playlist={playlist} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="profile-artists">
          <SectionHeader id="profile-artists" title="Gefolgte Künstler" action={artists.length > 0 ? <Count value={artists.length} /> : undefined} />
          {artists.length === 0 ? (
            <EmptyState title="Keine gefolgten Künstler" />
          ) : (
            <Shelf label={`Künstler, denen ${name} folgt`}>
              {artists.map((artist) => (
                <ArtistCard key={String(artist.id)} artist={artist} />
              ))}
            </Shelf>
          )}
        </section>
      </div>
    </>
  );
}
