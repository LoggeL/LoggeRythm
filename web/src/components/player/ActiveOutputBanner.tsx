"use client";

import Link from "next/link";
import { activeRemoteDevice, useConnectStore } from "@/store/connect";
import { usePartyStore } from "@/store/party";
import { UsersIcon } from "@/components/icons";
import { DeviceTypeIcon } from "@/components/player/DeviceSelector";
import { toast } from "@/store/toast";

/**
 * Spotify-style slim output bar rendered in PlayerBar and NowPlaying when:
 * - Controlling playback on another personal Connect device ("Wiedergabe auf <Device>")
 * - Participating in an active collaborative Jam ("Jam: <Name> · Host ...")
 */
export default function ActiveOutputBanner({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const activeDeviceId = useConnectStore((s) => s.activeDeviceId);
  const deviceId = useConnectStore((s) => s.deviceId);
  const devices = useConnectStore((s) => s.devices);
  const transferringToId = useConnectStore((s) => s.transferringToId);
  const actions = useConnectStore((s) => s.actions);
  const setSelectorOpen = useConnectStore((s) => s.setSelectorOpen);

  const partyActive = usePartyStore((s) => s.active);
  const partyCode = usePartyStore((s) => s.code);
  const partyName = usePartyStore((s) => s.name);
  const partyHostName = usePartyStore((s) => s.hostName);
  const partyIsHost = usePartyStore((s) => s.isHost);
  const partyMembers = usePartyStore((s) => s.members);
  const listenLocally = usePartyStore((s) => s.listenLocally);

  if (partyActive && partyCode) {
    return (
      <div
        data-testid="jam-output-banner"
        className={`flex items-center justify-between gap-3 border-t border-accent/25 bg-[color-mix(in_srgb,var(--accent)_11%,var(--panel))] px-4 text-xs text-foreground ${
          compact ? "mx-2 mb-1.5 rounded-lg border py-1.5" : "py-1.5"
        }`}
      >
        <Link
          href={`/party/${encodeURIComponent(partyCode)}`}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
        >
          <UsersIcon width={14} height={14} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">
            <span className="font-semibold text-accent">Jam</span>{" "}
            <span className="font-semibold">{partyName || partyCode}</span>
            <span className="text-muted">
              {" "}
              · {partyIsHost ? "Du bist Host" : `Host ${partyHostName}`} · {partyMembers.length}{" "}
              {partyMembers.length === 1 ? "Person" : "Personen"}
              {!partyIsHost && !listenLocally ? " · Nur steuern" : ""}
            </span>
          </span>
        </Link>
        <Link
          href={`/party/${encodeURIComponent(partyCode)}`}
          onClick={onNavigate}
          className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-accent hover:underline"
        >
          Zur Jam
        </Link>
      </div>
    );
  }

  const remote = activeRemoteDevice({ enabled, status, activeDeviceId, deviceId, devices });
  if (!remote) return null;

  const pullHere = () => {
    if (!actions || !deviceId) {
      toast.error("Connect ist nicht verbunden.");
      return;
    }
    void actions.transferTo(deviceId).catch((cause: unknown) => {
      toast.error(
        `Übertragung auf dieses Gerät fehlgeschlagen: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });
  };

  return (
    <div
      data-testid="remote-output-banner"
      className={`flex items-center justify-between gap-3 border-t border-accent/35 bg-[color-mix(in_srgb,var(--accent)_16%,var(--panel))] px-4 text-xs text-foreground ${
        compact ? "mx-2 mb-1.5 rounded-lg border py-1.5" : "py-1.5"
      }`}
    >
      <button
        type="button"
        onClick={(event) => setSelectorOpen(true, event.currentTarget)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
      >
        <DeviceTypeIcon type={remote.device_type} width={14} height={14} className="shrink-0 text-accent" />
        <span className="truncate">
          Wiedergabe auf <strong className="font-semibold text-accent">{remote.name}</strong>
        </span>
      </button>
      <button
        type="button"
        disabled={transferringToId === deviceId}
        onClick={pullHere}
        className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-accent hover:underline disabled:opacity-50"
      >
        {transferringToId === deviceId ? "Überträgt…" : "Hier abspielen"}
      </button>
    </div>
  );
}
