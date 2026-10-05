export function rememberSearch(recent: string[], input: string): string[] {
  const term = input.trim();
  if (!term) return recent;
  return [term, ...recent.filter((entry) => entry !== term)].slice(0, 8);
}
