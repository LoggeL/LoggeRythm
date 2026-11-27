import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  API_COMPATIBILITY_OPERATION,
  GENERATED_API_OPERATIONS,
  GENERATED_OPENAPI_CONTRACT_VERSION,
  type AdminUsageOverviewResponseWire,
  type AdminUserUsageDetailResponseWire,
  type GeneratedApiRequest,
  type GeneratedApiRequestArgs,
  type GeneratedApiResponse,
  type LoginRequestWire,
  type PlaylistEntryReorderWire,
  type UserOutWire,
  type UserStatsWire,
} from './contract';

describe('generated OpenAPI contract', () => {
  it('describes every versioned operation and preserves compatibility metadata', () => {
    expect(Object.keys(GENERATED_API_OPERATIONS)).toHaveLength(138);
    expect(GENERATED_API_OPERATIONS.auth_providers_api_auth_providers_get).toEqual({
      method: 'GET',
      path: '/api/auth/providers',
      auth: 'none',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.google_mobile_start_api_auth_google_mobile_start_post,
    ).toEqual({
      method: 'POST',
      path: '/api/auth/google/mobile/start',
      auth: 'none',
      requestMediaTypes: ['application/json'],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.google_mobile_exchange_api_auth_google_mobile_exchange_post,
    ).toEqual({
      method: 'POST',
      path: '/api/auth/google/mobile/exchange',
      auth: 'none',
      requestMediaTypes: ['application/json'],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.deduplicate_likes_api_admin_likes_deduplicate_post,
    ).toEqual({
      method: 'POST',
      path: '/api/admin/likes/deduplicate',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(GENERATED_API_OPERATIONS.get_agent_manifest_api_agent_get).toEqual({
      method: 'GET',
      path: '/api/agent',
      auth: 'none',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(GENERATED_OPENAPI_CONTRACT_VERSION).toBe('v2');
    expect(API_COMPATIBILITY_OPERATION).toBe(
      GENERATED_API_OPERATIONS.get_api_compatibility_api_version_get,
    );
    expect(GENERATED_API_OPERATIONS.login_api_auth_login_post).toEqual({
      method: 'POST',
      path: '/api/auth/login',
      auth: 'none',
      requestMediaTypes: ['application/json'],
      successStatuses: [200],
    });
    expect(GENERATED_API_OPERATIONS.mixes_api_home_mixes_get.auth).toBe('optional');
    expect(GENERATED_API_OPERATIONS.delete_me_api_me_delete.successStatuses).toEqual([204]);
    expect(
      GENERATED_API_OPERATIONS
        .remove_playlist_entry_api_playlists__playlist_id__tracks_entries__entry_id__delete,
    ).toMatchObject({
      method: 'DELETE',
      path: '/api/playlists/{playlist_id}/tracks/entries/{entry_id}',
      auth: 'required',
    });
    expect(GENERATED_API_OPERATIONS.get_stats_api_me_stats_get).toEqual({
      method: 'GET',
      path: '/api/me/stats',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(GENERATED_API_OPERATIONS.admin_usage_api_admin_usage_get).toEqual({
      method: 'GET',
      path: '/api/admin/usage',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.admin_user_usage_api_admin_usage_users__user_id__get,
    ).toEqual({
      method: 'GET',
      path: '/api/admin/usage/users/{user_id}',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.set_collaborative_api_playlists__playlist_id__collaborative_patch,
    ).toEqual({
      method: 'PATCH',
      path: '/api/playlists/{playlist_id}/collaborative',
      auth: 'required',
      requestMediaTypes: ['application/json'],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS
        .search_invite_candidates_api_playlists__playlist_id__invite_candidates_get,
    ).toEqual({
      method: 'GET',
      path: '/api/playlists/{playlist_id}/invite-candidates',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS
        .list_playlist_invitations_api_playlists__playlist_id__invitations_get,
    ).toEqual({
      method: 'GET',
      path: '/api/playlists/{playlist_id}/invitations',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS.invite_to_playlist_api_playlists__playlist_id__invitations_post,
    ).toEqual({
      method: 'POST',
      path: '/api/playlists/{playlist_id}/invitations',
      auth: 'required',
      requestMediaTypes: ['application/json'],
      successStatuses: [201],
    });
    expect(
      GENERATED_API_OPERATIONS
        .withdraw_playlist_invitation_api_playlists__playlist_id__invitations__user_id__delete,
    ).toEqual({
      method: 'DELETE',
      path: '/api/playlists/{playlist_id}/invitations/{user_id}',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [204],
    });
    expect(
      GENERATED_API_OPERATIONS.list_my_playlist_invitations_api_playlists_invitations_get,
    ).toEqual({
      method: 'GET',
      path: '/api/playlists/invitations',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS
        .accept_playlist_invitation_api_playlists_invitations__invitation_id__accept_post,
    ).toEqual({
      method: 'POST',
      path: '/api/playlists/invitations/{invitation_id}/accept',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
    expect(
      GENERATED_API_OPERATIONS
        .decline_playlist_invitation_api_playlists_invitations__invitation_id__decline_post,
    ).toEqual({
      method: 'POST',
      path: '/api/playlists/invitations/{invitation_id}/decline',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [204],
    });
    // Invite links and email-based collaborator adds no longer exist.
    const operations: string[] = Object.values(GENERATED_API_OPERATIONS).map(
      (op) => `${op.method} ${op.path}`,
    );
    expect(operations).not.toContain('GET /api/playlists/{playlist_id}/invite');
    expect(operations).not.toContain('POST /api/playlists/{playlist_id}/invite');
    expect(operations).not.toContain('DELETE /api/playlists/{playlist_id}/invite');
    expect(operations).not.toContain('GET /api/playlists/invites/{token}');
    expect(operations).not.toContain('POST /api/playlists/invites/{token}/accept');
    expect(operations).not.toContain('POST /api/playlists/{playlist_id}/collaborators');
    expect(
      GENERATED_API_OPERATIONS.leave_playlist_api_playlists__playlist_id__leave_post,
    ).toEqual({
      method: 'POST',
      path: '/api/playlists/{playlist_id}/leave',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [204],
    });
  });

  it('provides exact request and success-response stubs', () => {
    expectTypeOf<GeneratedApiRequest<'login_api_auth_login_post'>>().toEqualTypeOf<{
      body: LoginRequestWire;
    }>();
    expectTypeOf<GeneratedApiResponse<'login_api_auth_login_post'>>().toEqualTypeOf<UserOutWire>();
    expectTypeOf<GeneratedApiRequest<'lyrics_api_lyrics_get'>>().toEqualTypeOf<{
      query: {
        album?: string | null;
        artist: string;
        deezer_id?: string | null;
        duration_sec?: number | null;
        title: string;
        variant?: string;
      };
    }>();
    expectTypeOf<GeneratedApiResponse<'delete_me_api_me_delete'>>().toEqualTypeOf<undefined>();
    expectTypeOf<GeneratedApiResponse<'get_stats_api_me_stats_get'>>()
      .toEqualTypeOf<UserStatsWire>();
    expectTypeOf<GeneratedApiResponse<'admin_usage_api_admin_usage_get'>>()
      .toEqualTypeOf<AdminUsageOverviewResponseWire>();
    expectTypeOf<
      GeneratedApiResponse<'admin_user_usage_api_admin_usage_users__user_id__get'>
    >().toEqualTypeOf<AdminUserUsageDetailResponseWire>();
    expectTypeOf<GeneratedApiRequest<
      'reorder_playlist_entries_api_playlists__playlist_id__tracks_entries_order_patch'
    >>().toEqualTypeOf<{
      path: { playlist_id: number };
      body: PlaylistEntryReorderWire;
    }>();
    expectTypeOf<GeneratedApiRequestArgs<'me_api_auth_me_get'>>().toEqualTypeOf<
      [request?: Record<never, never>]
    >();
    expectTypeOf<
      GeneratedApiResponse<'leave_playlist_api_playlists__playlist_id__leave_post'>
    >().toEqualTypeOf<undefined>();
  });
});
