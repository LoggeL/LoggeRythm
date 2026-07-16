import * as endpoints from '../api/endpoints';
import type { RegisterRequest } from '../api/endpoints';
import type { User } from '../api/types';

export type { RegisterRequest } from '../api/endpoints';

/**
 * Transport seam for the native authentication lifecycle.
 *
 * Implementations expose endpoint operations only. They do not own a second
 * credential store, Query cache, or authenticated identity; those lifecycle
 * decisions remain at the existing API-client/AuthProvider boundary.
 */
export interface AuthRepository {
  me(): Promise<User>;
  login(email: string, password: string): Promise<User>;
  register(request: RegisterRequest): Promise<User>;
  logout(): Promise<{ ok: boolean }>;
  deleteMe(): Promise<void>;
}

/** Production adapter backed by the decoded, session-aware API endpoints. */
export const defaultAuthRepository: AuthRepository = Object.freeze({
  me: () => endpoints.me(),
  login: (email: string, password: string) => endpoints.login(email, password),
  register: (request: RegisterRequest) => endpoints.register(request),
  logout: () => endpoints.logout(),
  deleteMe: () => endpoints.deleteMe(),
});
