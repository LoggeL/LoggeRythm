import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { defaultAuthRepository, type RegisterRequest } from './repository';

const endpoints = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  getAuthProviders: vi.fn(),
  startGoogleMobileAuth: vi.fn(),
  exchangeGoogleMobileAuth: vi.fn(),
  logout: vi.fn(),
  deleteMe: vi.fn(),
}));

vi.mock('../api/endpoints', () => endpoints);

const user: User = {
  id: 17,
  email: 'person@example.test',
  display_name: 'Person',
  is_admin: false,
  is_approved: true,
  avatar_url: null,
};

const registration: RegisterRequest = {
  email: 'new@example.test',
  password: 'password123',
  display_name: 'New Person',
  invite: 'invite-code',
};

describe('default auth repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endpoints.me.mockResolvedValue(user);
    endpoints.login.mockResolvedValue(user);
    endpoints.register.mockResolvedValue(user);
    endpoints.getAuthProviders.mockResolvedValue({ google: true });
    endpoints.startGoogleMobileAuth.mockResolvedValue({
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      handoff_secret: 'secret',
      expires_in_sec: 600,
    });
    endpoints.exchangeGoogleMobileAuth.mockResolvedValue(user);
    endpoints.logout.mockResolvedValue({ ok: true });
    endpoints.deleteMe.mockResolvedValue(undefined);
  });

  it('is a stable adapter that forwards every typed endpoint operation', async () => {
    expect(Object.isFrozen(defaultAuthRepository)).toBe(true);

    await expect(defaultAuthRepository.me()).resolves.toBe(user);
    await expect(defaultAuthRepository.login('person@example.test', 'password123'))
      .resolves.toBe(user);
    await expect(defaultAuthRepository.register(registration)).resolves.toBe(user);
    await expect(defaultAuthRepository.getAuthProviders('https://music.example.test'))
      .resolves.toEqual({ google: true });
    await expect(defaultAuthRepository.startGoogleMobileAuth('INV1', 'https://music.example.test'))
      .resolves.toMatchObject({ handoff_secret: 'secret' });
    await expect(
      defaultAuthRepository.exchangeGoogleMobileAuth('code1', 'secret', 'https://music.example.test'),
    ).resolves.toBe(user);
    await expect(defaultAuthRepository.logout()).resolves.toEqual({ ok: true });
    await expect(defaultAuthRepository.deleteMe()).resolves.toBeUndefined();

    expect(endpoints.me).toHaveBeenCalledOnce();
    expect(endpoints.login).toHaveBeenCalledExactlyOnceWith(
      'person@example.test',
      'password123',
    );
    expect(endpoints.register).toHaveBeenCalledExactlyOnceWith(registration);
    expect(endpoints.getAuthProviders).toHaveBeenCalledExactlyOnceWith(
      'https://music.example.test',
      undefined,
    );
    expect(endpoints.startGoogleMobileAuth).toHaveBeenCalledExactlyOnceWith(
      'INV1',
      'https://music.example.test',
    );
    expect(endpoints.exchangeGoogleMobileAuth).toHaveBeenCalledExactlyOnceWith(
      'code1',
      'secret',
      'https://music.example.test',
    );
    expect(endpoints.logout).toHaveBeenCalledOnce();
    expect(endpoints.deleteMe).toHaveBeenCalledOnce();
  });

  it('passes endpoint failures through unchanged for AuthProvider policy', async () => {
    const failure = new Error('transport failed');
    endpoints.login.mockRejectedValueOnce(failure);

    await expect(defaultAuthRepository.login('person@example.test', 'password123'))
      .rejects.toBe(failure);
  });
});
