"use client";

import Link from "next/link";
import { useMe } from "@/hooks/useAuth";
import { useFollowing, useToggleFollow } from "@/hooks/useFollows";
import { CheckIcon, PlusIcon } from "@/components/icons";
import QueryError from "@/components/ui/QueryError";
import type { ArtistSummary } from "@/types";

const BUTTON = "action-secondary min-w-[7.75rem] px-4";
const FOLLOWING = "border-foreground/30 bg-foreground/[0.08]";

/**
 * Follow / unfollow button for an artist. Signed-out visitors are sent to the
 * login; while the account or the follow list is unknown the button stays
 * disabled instead of guessing a state.
 */
export function FollowButton({ artist }: { artist: ArtistSummary }) {
  const account = useMe();
  const me = account.data;
  const follows = useFollowing(!!me);
  const toggleFollow = useToggleFollow();
  const idle = (
    <>
      <PlusIcon aria-hidden="true" width={16} height={16} />
      Folgen
    </>
  );

  if (account.isLoading) {
    return (
      <button type="button" disabled className={BUTTON}>
        {idle}
      </button>
    );
  }
  if (!me) {
    return account.isError ? (
      <button type="button" disabled className={BUTTON} title="Dein Konto konnte nicht geladen werden.">
        {idle}
      </button>
    ) : (
      <Link href="/login" className={BUTTON} title="Melde dich an, um Künstlern zu folgen.">
        {idle}
      </Link>
    );
  }

  const following = follows.data?.some((followed) => String(followed.id) === String(artist.id)) ?? false;
  const unknown = follows.isLoading || follows.isError;
  return (
    <button
      type="button"
      onClick={() => toggleFollow.mutate({ artist, following })}
      disabled={unknown || toggleFollow.isPending}
      aria-pressed={following}
      aria-busy={follows.isLoading || toggleFollow.isPending}
      title={follows.isError ? "Folgestatus unbekannt" : following ? "Nicht mehr folgen" : undefined}
      className={`${BUTTON} ${following ? FOLLOWING : ""}`}
    >
      {following ? (
        <>
          <CheckIcon aria-hidden="true" width={16} height={16} />
          Gefolgt
        </>
      ) : (
        idle
      )}
    </button>
  );
}

/** Reports account / follow-list failures that leave the follow state unknown. */
export function FollowErrors() {
  const account = useMe();
  const follows = useFollowing(!!account.data);
  return (
    <>
      <QueryError label="Deine Kontodaten" query={account} className="mb-4" />
      {account.data && <QueryError label="Deine gefolgten Künstler" query={follows} className="mb-4" />}
    </>
  );
}
