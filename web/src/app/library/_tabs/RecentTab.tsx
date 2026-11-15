"use client";

import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import { ClockIcon } from "@/components/icons";
import { useRecentTracks, RECENT_QUEUE_CONTEXT } from "@/hooks/useRecentTracks";
import TabHeader from "./TabHeader";
import TrackCollection from "./TrackCollection";

/** The listening history kept on this device; it needs no request. */
export default function RecentTab() {
  const recent = useRecentTracks();
  return (
    <section aria-labelledby="recent-heading">
      <TabHeader id="recent-heading" title={RECENT_QUEUE_CONTEXT} meta={`${recent.length} Titel auf diesem Gerät`} />
      {recent.length === 0 ? (
        <EmptyState
          icon={<ClockIcon width={24} height={24} />}
          title="Noch kein Verlauf"
          action={
            <Link href="/genre" className="action-secondary">
              Musik entdecken
            </Link>
          }
        >
          Hier erscheinen die Titel, die du auf diesem Gerät hörst.
        </EmptyState>
      ) : (
        <TrackCollection tracks={recent} context={RECENT_QUEUE_CONTEXT} filterLabel="Im Verlauf suchen" />
      )}
    </section>
  );
}
