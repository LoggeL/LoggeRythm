import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { persistProfileUpdate } from './profileUpdate';

const user = (overrides: Partial<User> = {}): User => ({
  id: 7,
  email: 'ada@example.test',
  display_name: 'Ada',
  is_admin: false,
  is_approved: true,
  avatar_url: null,
  ...overrides,
});

describe('profile update orchestration', () => {
  it('updates, refreshes the same authenticated identity, then invalidates its public view', async () => {
    const order: string[] = [];
    const updateMe = vi.fn(async () => {
      order.push('update');
      return user({ email: 'ada@history.example' });
    });
    const refreshUser = vi.fn(async () => {
      order.push('refresh');
      return user({ email: 'ada@history.example' });
    });
    const invalidatePublicProfile = vi.fn(async () => {
      order.push('invalidate');
    });

    await expect(
      persistProfileUpdate(
        { email: 'ada@history.example', password: 'new-password' },
        7,
        { updateMe, refreshUser, invalidatePublicProfile },
      ),
    ).resolves.toEqual(user({ email: 'ada@history.example' }));

    expect(updateMe).toHaveBeenCalledExactlyOnceWith({
      email: 'ada@history.example',
      password: 'new-password',
    });
    expect(invalidatePublicProfile).toHaveBeenCalledExactlyOnceWith(7);
    expect(order).toEqual(['update', 'refresh', 'invalidate']);
  });

  it('does not refresh or invalidate after a rejected server update', async () => {
    const updateMe = vi.fn(async () => { throw new Error('email already used'); });
    const refreshUser = vi.fn(async () => user());
    const invalidatePublicProfile = vi.fn(async () => undefined);

    await expect(
      persistProfileUpdate(
        { email: 'taken@example.test' },
        7,
        { updateMe, refreshUser, invalidatePublicProfile },
      ),
    ).rejects.toThrow('email already used');
    expect(refreshUser).not.toHaveBeenCalled();
    expect(invalidatePublicProfile).not.toHaveBeenCalled();
  });

  it('fails closed when either response attempts to change account identity', async () => {
    const invalidatePublicProfile = vi.fn(async () => undefined);
    const refreshUser = vi.fn(async () => user());

    await expect(
      persistProfileUpdate(
        { display_name: 'Ada Byron' },
        7,
        {
          updateMe: vi.fn(async () => user({ id: 8 })),
          refreshUser,
          invalidatePublicProfile,
        },
      ),
    ).rejects.toThrow('different account identity');
    expect(refreshUser).not.toHaveBeenCalled();

    await expect(
      persistProfileUpdate(
        { display_name: 'Ada Byron' },
        7,
        {
          updateMe: vi.fn(async () => user()),
          refreshUser: vi.fn(async () => user({ id: 8 })),
          invalidatePublicProfile,
        },
      ),
    ).rejects.toThrow('different account identity');
    expect(invalidatePublicProfile).not.toHaveBeenCalled();
  });
});
