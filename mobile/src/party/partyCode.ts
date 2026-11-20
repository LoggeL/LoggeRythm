/** Party codes are six upper-case letters or digits (see api/app/routers/party.py). */
const PARTY_CODE = /^[A-Z0-9]{6}$/;

/** Normalise a code from a link or input; null when it cannot be a party code. */
export function normalizePartyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return PARTY_CODE.test(code) ? code : null;
}
