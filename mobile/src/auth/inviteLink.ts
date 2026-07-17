import { PRODUCTION_API_BASE } from '../config';

const APP_SCHEME = 'loggerythm:';
const INVITE_LIMIT = 512;

export interface RegistrationLink {
  invite: string | null;
  source: 'app-scheme' | 'production-https';
}

export function registrationLinkFromUrl(url: string): RegistrationLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const production = new URL(PRODUCTION_API_BASE);
  const isProductionRegistration =
    parsed.protocol === production.protocol &&
    parsed.host === production.host &&
    parsed.pathname === '/register';
  const isAppRegistration =
    parsed.protocol === APP_SCHEME &&
    (parsed.hostname === 'register' || parsed.pathname === '/register');

  if (!isProductionRegistration && !isAppRegistration) return null;
  const invite = parsed.searchParams.get('invite')?.trim() ?? '';
  return {
    invite: invite.length > 0 && invite.length <= INVITE_LIMIT ? invite : null,
    source: isProductionRegistration ? 'production-https' : 'app-scheme',
  };
}

export function registrationInviteFromUrl(url: string): string | null {
  return registrationLinkFromUrl(url)?.invite ?? null;
}
