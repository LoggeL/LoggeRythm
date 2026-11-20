import Avatar from "@/components/Avatar";
import type { PartyMember } from "@/types";

/** Who is listening along; the host is marked. */
export default function MembersCard({ members, hostName }: { members: PartyMember[]; hostName: string }) {
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
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2 gap-y-4">
          {members.map((member) => {
            const host = !member.is_guest && member.name === hostName;
            return (
              <li
                key={`${member.is_guest ? "g" : "u"}:${member.name}`}
                className="flex min-w-0 flex-col items-center text-center"
                title={member.is_guest ? `${member.name} (Gast ohne Konto)` : member.name}
              >
                <Avatar
                  src={member.avatar_url}
                  name={member.name}
                  size={44}
                  className={host ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}
                />
                <span className="mt-2 block w-full truncate text-xs font-medium text-foreground">{member.name}</span>
                {host && <span className="label-mono mt-0.5 text-[0.625rem]">Host</span>}
                {member.is_guest && <span className="label-mono mt-0.5 text-[0.625rem]">Gast</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
