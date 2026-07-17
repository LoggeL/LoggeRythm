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
  login(email: string, password: string, apiBase?: string): Promise<User>;
  register(request: RegisterRequest, apiBase?: string): Promise<User>;
  logout(apiBase?: string): Promise<{ ok: boolean }>;
  deleteMe(): Promise<void>;
}

/** Production adapter backed by the decoded, session-aware API endpoints. */
export const defaultAuthRepository: AuthRepository = Object.freeze({
  me: () => endpoints.me(),
  login: (email: string, password: string, apiBase?: string) =>
    apiBase === undefined
      ? endpoints.login(email, password)
      : endpoints.login(email, password, apiBase),
  register: (request: RegisterRequest, apiBase?: string) =>
    apiBase === undefined
      ? endpoints.register(request)
      : endpoints.register(request, apiBase),
  logout: (apiBase?: string) =>
    apiBase === undefined ? endpoints.logout() : endpoints.logout(apiBase),
  deleteMe: () => endpoints.deleteMe(),
});
