"use client";

import Avatar from "@/components/Avatar";
import type { PlaylistCollaborator } from "@/types";

const MAX_VISIBLE = 5;

export interface MemberAvatarEntry {
  key: string;
  name: string;
  avatarUrl?: string | null;
  isOwner?: boolean;
}

/**
 * Overlapping stack of playlist member avatars (owner first, then collaborators).
 * Clickable for owners and collaborators to jump straight into CollaboratorsDialog.
 */
export default function CollaboratorAvatars({
  ownerName,
  ownerAvatarUrl,
  collaborators,
  totalCount,
  onClick,
}: {
  ownerName?: string | null;
  ownerAvatarUrl?: string | null;
  collaborators: readonly PlaylistCollaborator[];
  totalCount: number;
  onClick?: () => void;
}) {
  const members: MemberAvatarEntry[] = [
    {
      key: "owner",
      name: ownerName || "Eigentümer",
      avatarUrl: ownerAvatarUrl,
      isOwner: true,
    },
  ];
  for (const collaborator of collaborators) {
    members.push({
      key: `u:${collaborator.user_id}`,
      name: collaborator.display_name || "Unbekannt",
      avatarUrl: collaborator.avatar_url,
    });
  }

  const visible = members.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, totalCount - visible.length);
  const summaryNames = members
    .slice(0, 3)
    .map((m) => m.name)
    .join(", ");
  const title =
    members.length > 3
      ? `${summaryNames} +${members.length - 3} weitere`
      : summaryNames || `${totalCount} Mitwirkende`;

  const stack = (
    <>
      <span className="inline-flex items-center -space-x-1.5">
        {visible.map((member) => (
          <Avatar
            key={member.key}
            src={member.avatarUrl}
            name={member.name}
            size={24}
            className={`ring-2 ring-background ${
              member.isOwner ? "outline outline-1 outline-accent/60" : ""
            }`}
          />
        ))}
        {overflow > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-panel px-1.5 font-mono text-[10px] font-semibold text-foreground ring-2 ring-background tabular-nums">
            +{overflow}
          </span>
        )}
      </span>
      <span className="text-xs font-medium text-muted">
        {totalCount} {totalCount === 1 ? "Person" : "Personen"}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={`Mitwirkende anzeigen (${title})`}
        className="inline-flex items-center gap-2 rounded-full pr-1.5 align-middle transition-opacity hover:opacity-85"
      >
        {stack}
      </button>
    );
  }

  return (
    <span title={title} className="inline-flex items-center gap-2 align-middle">
      {stack}
    </span>
  );
}
