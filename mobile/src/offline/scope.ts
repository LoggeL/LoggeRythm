/** Recover the server from the manifest's account binding without network or auth. */
export function offlineScopeOrigin(scope: string): string {
  const marker = '::user:';
  const markerIndex = scope.lastIndexOf(marker);
  if (markerIndex <= 0 || markerIndex + marker.length >= scope.length) {
    throw new Error('Offline account scope is invalid');
  }
  const origin = scope.slice(0, markerIndex);
  if (new URL(origin).origin !== origin) {
    throw new Error('Offline account scope origin is not canonical');
  }
  return origin;
}
