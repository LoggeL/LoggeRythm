import { api } from "@/lib/api";
import type { SystemStatus } from "@/types";

function statusContractError(field: string, expectation: string): never {
  throw new Error(
    `Ungültige Antwort von /admin/status: „${field}“ muss ${expectation} sein.`,
  );
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    statusContractError(field, "ein Objekt");
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") statusContractError(field, "ein Wahrheitswert");
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    statusContractError(field, "nicht-leerer Text");
  }
}

function requireCount(value: unknown, field: string, positive = false): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    statusContractError(
      field,
      positive
        ? "eine positive ganze Zahl"
        : "eine nicht-negative ganze Zahl",
    );
  }
}

function assertSystemStatus(value: unknown): asserts value is SystemStatus {
  const root = requireRecord(value, "Antwort");
  const deezer = requireRecord(root.deezer, "deezer");
  const storage = requireRecord(root.storage, "storage");
  const users = requireRecord(root.users, "users");
  const content = requireRecord(root.content, "content");
  const integrations = requireRecord(root.integrations, "integrations");
  const system = requireRecord(root.system, "system");

  requireBoolean(deezer.arl_configured, "deezer.arl_configured");
  requireBoolean(deezer.arl_ok, "deezer.arl_ok");
  requireText(deezer.quality, "deezer.quality");

  for (const field of [
    "track_count",
    "total_bytes",
    "disk_used",
    "disk_free",
    "retention_days",
  ] as const) {
    requireCount(storage[field], `storage.${field}`);
  }
  requireCount(storage.disk_total, "storage.disk_total", true);
  if ((storage.disk_used as number) > (storage.disk_total as number)) {
    statusContractError(
      "storage.disk_used",
      "kleiner oder gleich „storage.disk_total“",
    );
  }

  for (const field of ["total", "approved", "pending", "admins"] as const) {
    requireCount(users[field], `users.${field}`);
  }
  if ((users.approved as number) > (users.total as number)) {
    statusContractError("users.approved", "kleiner oder gleich „users.total“");
  }
  if ((users.pending as number) > (users.total as number)) {
    statusContractError("users.pending", "kleiner oder gleich „users.total“");
  }
  if ((users.admins as number) > (users.total as number)) {
    statusContractError("users.admins", "kleiner oder gleich „users.total“");
  }

  for (const field of [
    "playlists",
    "likes",
    "follows",
    "plays",
    "stored_lyrics",
    "parties",
    "invites_total",
    "invites_used",
  ] as const) {
    requireCount(content[field], `content.${field}`);
  }
  if ((content.invites_used as number) > (content.invites_total as number)) {
    statusContractError(
      "content.invites_used",
      "kleiner oder gleich „content.invites_total“",
    );
  }

  requireBoolean(
    integrations.spotify_configured,
    "integrations.spotify_configured",
  );
  requireBoolean(
    integrations.lastfm_configured,
    "integrations.lastfm_configured",
  );
  requireText(system.app_env, "system.app_env");
  requireText(system.database, "system.database");
  requireBoolean(system.jwt_secure, "system.jwt_secure");
  requireBoolean(system.cookie_secure, "system.cookie_secure");
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const value: unknown = await api.adminStatus();
  assertSystemStatus(value);
  return value;
}

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    statusContractError("Speicherwert", "eine nicht-negative ganze Zahl");
  }
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= units.length) {
    statusContractError("Speicherwert", "kleiner als 1 PB");
  }
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
