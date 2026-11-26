export type AdminSection = "usage" | "users" | "storage" | "status";

export const ADMIN_SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "usage", label: "Nutzung" },
  { key: "users", label: "Benutzer & Einladungen" },
  { key: "storage", label: "Speicher" },
  { key: "status", label: "Systemstatus" },
];

export function parseAdminSection(raw: string | null | undefined): AdminSection {
  if (raw === "usage" || raw === "users" || raw === "storage" || raw === "status") {
    return raw;
  }
  return "usage";
}

export function buildAdminSectionHref(
  section: AdminSection,
  extras?: { range?: string | null; user?: string | null },
): string {
  const params = new URLSearchParams();
  params.set("tab", "admin");
  params.set("section", section);
  if (section === "usage" && extras) {
    if (extras.range === "7d" || extras.range === "30d" || extras.range === "all") {
      params.set("range", extras.range);
    }
    const userId = extras.user?.trim();
    if (userId) {
      params.set("user", userId);
    }
  }
  return `/account?${params.toString()}`;
}
