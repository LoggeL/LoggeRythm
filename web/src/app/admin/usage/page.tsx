import { redirect } from "next/navigation";
import { buildAdminSectionHref } from "@/app/account/_admin/sections";

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** Legacy standalone URL: redirect straight into the unified Profile Administration hub. */
export default async function LegacyAdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(
    buildAdminSectionHref("usage", {
      range: firstParam(params.range),
      user: firstParam(params.user),
    }),
  );
}
