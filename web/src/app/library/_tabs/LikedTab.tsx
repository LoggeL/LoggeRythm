"use client";

import Link from "next/link";
import QueryState, { type StatefulQuery } from "@/components/browse/QueryState";
import EmptyState from "@/components/ui/EmptyState";
import { RowListSkeleton } from "@/components/Skeleton";
import { HeartIcon } from "@/components/icons";
import type { Track } from "@/types";
import TabHeader from "./TabHeader";
import TrackCollection from "./TrackCollection";

export default function LikedTab({ query }: { query: StatefulQuery<Track[]> }) {
  return (
    <section aria-labelledby="liked-heading">
      <TabHeader id="liked-heading" title="Gelikte Titel" meta={query.data ? `${query.data.length} Titel` : undefined} />
      <QueryState
        query={query}
        label="Deine gelikten Titel"
        skeleton={<RowListSkeleton />}
        empty={
          <EmptyState
            icon={<HeartIcon width={24} height={24} />}
            title="Du hast noch keine Titel geliked."
            action={
              <Link href="/search" className="action-secondary">
                Lieblingsmusik suchen
              </Link>
            }
          >
            Tippe bei einem Titel auf das Herz, dann findest du ihn hier wieder.
          </EmptyState>
        }
      >
        {(tracks) => <TrackCollection tracks={tracks} context="Gelikte Titel" filterLabel="In gelikten Titeln suchen" sortable />}
      </QueryState>
    </section>
  );
}
