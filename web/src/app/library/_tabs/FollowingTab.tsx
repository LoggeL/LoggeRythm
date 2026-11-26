"use client";

import { useState } from "react";
import Link from "next/link";
import ArtistCard from "@/components/ArtistCard";
import QueryState, { type StatefulQuery } from "@/components/browse/QueryState";
import EmptyState from "@/components/ui/EmptyState";
import { CardGridSkeleton } from "@/components/Skeleton";
import { UserIcon } from "@/components/icons";
import type { ArtistSummary } from "@/types";
import ListFilter, { NoFilterMatch } from "./ListFilter";
import TabHeader from "./TabHeader";
import { FILTER_THRESHOLD, matchesFilter } from "./filter";

export default function FollowingTab({ query }: { query: StatefulQuery<ArtistSummary[]> }) {
  const [term, setTerm] = useState("");
  return (
    <section aria-labelledby="following-heading">
      <TabHeader id="following-heading" title="Deine Künstler">
        <Link href="/radar" className="action-secondary">
          Release Radar
        </Link>
      </TabHeader>
      <QueryState
        query={query}
        label="Deine gefolgten Künstler"
        skeleton={<CardGridSkeleton count={6} />}
        empty={
          <EmptyState
            icon={<UserIcon width={24} height={24} />}
            title="Du folgst noch keinen Künstlern."
            action={
              <Link href="/search" className="action-secondary">
                Künstler suchen
              </Link>
            }
          >
            Folge Künstlern, um ihre neuen Titel im Release Radar zu sehen.
          </EmptyState>
        }
      >
        {(artists) => {
          const listed = artists.filter((artist) => matchesFilter(term, artist.name));
          return (
            <>
              {artists.length > FILTER_THRESHOLD && <ListFilter label="Künstler filtern" value={term} onChange={setTerm} className="mb-4 sm:max-w-64" />}
              {listed.length === 0 ? (
                <NoFilterMatch term={term} onReset={() => setTerm("")} />
              ) : (
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {listed.map((artist) => (
                    <ArtistCard key={String(artist.id)} artist={artist} />
                  ))}
                </div>
              )}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
