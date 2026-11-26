import { redirect } from "next/navigation";
import { buildAdminSectionHref } from "@/app/account/_admin/sections";

/** Legacy standalone URL: redirect straight into the unified Profile Administration hub. */
export default function LegacyStatusPage() {
  redirect(buildAdminSectionHref("status"));
}
