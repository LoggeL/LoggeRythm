export function resolveServerUrl(value: string, apiBase: string): string {
  let resolved: URL;
  try {
    resolved = new URL(value, `${apiBase.replace(/\/+$/, '')}/`);
  } catch (error) {
    throw new Error(`Invalid server media URL "${value}": ${(error as Error).message}`);
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error(`Server media URL "${value}" must use http:// or https://`);
  }
  return resolved.toString();
}

export function tryResolveServerUrl(value: string | null | undefined, apiBase: string): string | null {
  if (!value) return null;
  try {
    return resolveServerUrl(value, apiBase);
  } catch {
    return null;
  }
}
