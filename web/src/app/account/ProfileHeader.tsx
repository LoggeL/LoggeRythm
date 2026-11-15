"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentTrack, usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { decodeListeningStats } from "@/lib/listeningStats";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Cover from "@/components/ui/Cover";
import { EditIcon } from "@/components/icons";
import type { User, UserStats } from "@/types";
import { Badge, errorMessage, formatCount, Metric, SectionError, StatusBadge } from "./presentation";

/** Identity hero: avatar (click to replace), name, state and listening summary. */
export default function ProfileHeader({ me }: { me: User }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const liveTrack = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  // Shares the validated query with the detailed listening statistics.
  const stats = useQuery<UserStats>({
    queryKey: ["stats"],
    queryFn: async () => decodeListeningStats(await api.stats()),
  });
  const signalTrack = liveTrack ?? stats.data?.recent[0] ?? null;

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: () => {
      toast.success("Profilbild aktualisiert.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error(`Profilbild konnte nicht hochgeladen werden: ${errorMessage(err)}`),
  });

  function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadAvatar.mutate(file);
  }

  return (
    <header aria-label="Dein Profil" className="@container flex flex-col gap-6">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-end">
        <input ref={fileInput} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={handleAvatarFile} className="hidden" />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploadAvatar.isPending}
          aria-label="Profilbild ändern"
          title="Profilbild ändern"
          className="group relative shrink-0 rounded-full disabled:opacity-60"
        >
          <Avatar src={me.avatar_url} name={me.display_name} size={112} className="cover-shadow" />
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-4 border-background bg-foreground text-backdrop transition-transform group-hover:scale-110 motion-reduce:transition-none"
          >
            <EditIcon width={14} height={14} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">Konto</p>
          <h1 className="page-title">{me.display_name}</h1>
          <p className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">{me.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge approved={!!me.is_approved} />
            {me.is_admin && <Badge tone="accent">Admin</Badge>}
            {uploadAvatar.isPending && (
              <span role="status" className="text-xs text-muted">
                Profilbild wird hochgeladen…
              </span>
            )}
          </div>
        </div>
      </div>

      {stats.error && <SectionError label="Die Hörzahlen" error={stats.error} retrying={stats.isFetching} onRetry={() => void stats.refetch()} />}
      {stats.isLoading && (
        <div role="status" aria-label="Hörzahlen werden geladen" className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-hairline py-4 @4xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <span key={index} className="skeleton block h-[4.5rem] rounded-[var(--radius-card)] last:col-span-2 @4xl:h-20 @4xl:last:col-span-1" />
          ))}
        </div>
      )}
      {stats.data && (
        <dl aria-label="Kennzahlen" className="grid grid-cols-2 border-y border-hairline py-4 @4xl:grid-cols-[auto_auto_minmax(0,1fr)]">
          <Metric size="lg" value={formatCount(stats.data.total_plays)} label="Wiedergaben gesamt" className="py-1 pr-4 @4xl:pr-7" />
          <Metric
            size="lg"
            value={formatCount(stats.data.total_plays_month)}
            label="In den letzten 30 Tagen"
            className="border-l border-hairline py-1 pl-4 @4xl:px-7"
          />
          <Metric
            size="lg"
            truncate
            value={stats.data.top_artists[0]?.label ?? "–"}
            label="Meistgehörter Künstler"
            className="col-span-2 mt-4 border-t border-hairline pt-4 @4xl:col-span-1 @4xl:mt-0 @4xl:border-l @4xl:border-t-0 @4xl:py-1 @4xl:pl-7"
          />
        </dl>
      )}

      {signalTrack && (
        <div className="flex w-fit max-w-full items-center gap-3 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-4">
          <Cover src={signalTrack.cover} className="h-9 w-9 rounded-full" />
          <p className="min-w-0 truncate text-sm">
            <span className="text-muted">{isPlaying && liveTrack ? "Jetzt läuft" : "Zuletzt gehört"} · </span>
            <span className="font-semibold">{signalTrack.title}</span>
            <span className="text-muted"> · {signalTrack.artist}</span>
          </p>
        </div>
      )}
    </header>
  );
}
