import Avatar from "@/components/Avatar";
import { CloseIcon } from "@/components/icons";
import type { PartyMember } from "@/types";

/** Who is listening along in the Jam; host is marked and can remove participants. */
export default function MembersCard({
  members,
  hostName,
  isHost = false,
  locked = false,
  onKick,
}: {
  members: PartyMember[];
  hostName: string;
  isHost?: boolean;
  locked?: boolean;
  onKick?: (memberKey: string, name: string) => void;
}) {
  return (
    <section aria-labelledby="party-members-title" className="min-w-0">
      <div className="section-heading">
        <h2 id="party-members-title">Mit dabei</h2>
        <p className="label-mono shrink-0 pb-1 tabular-nums">
          {members.length} {members.length === 1 ? "Person" : "Personen"}
        </p>
      </div>
      {members.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">Noch niemand hier. Teile den Einladungslink, um Leute dazuzuholen.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-x-2 gap-y-4">
          {members.map((member) => {
            const host = member.is_host ?? (!member.is_guest && member.name === hostName);
            const canKick = isHost && !host && Boolean(member.key) && Boolean(onKick);
            return (
              <li
                key={member.key ?? `${member.is_guest ? "g" : "u"}:${member.name}`}
                className="group relative flex min-w-0 flex-col items-center text-center"
                title={member.is_guest ? `${member.name} (Gast ohne Konto)` : member.name}
              >
                <div className="relative">
                  <Avatar
                    src={member.avatar_url}
                    name={member.name}
                    size={44}
                    className={host ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}
                  />
                  {canKick && member.key && onKick && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onKick(member.key as string, member.name)}
                      aria-label={`${member.name} aus der Jam entfernen`}
                      title={`${member.name} entfernen`}
                      className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full border border-border bg-panel text-muted opacity-100 transition hover:border-danger hover:text-danger focus-visible:opacity-100 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <CloseIcon width={12} height={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <span className="mt-2 block w-full truncate text-xs font-medium text-foreground">{member.name}</span>
                {host && <span className="label-mono mt-0.5 text-[0.625rem] text-accent">Host</span>}
                {member.is_guest && <span className="label-mono mt-0.5 text-[0.625rem]">Gast</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
