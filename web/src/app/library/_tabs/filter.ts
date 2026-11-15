/** Case-insensitive "contains" over the given fields; an empty term matches all. */
export function matchesFilter(term: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = term.trim().toLocaleLowerCase("de");
  if (!needle) return true;
  return fields.some((field) => !!field && field.toLocaleLowerCase("de").includes(needle));
}

/** Lists shorter than this are scanned faster than they are filtered. */
export const FILTER_THRESHOLD = 10;
