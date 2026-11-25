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
    expect(Object.keys(GENERATED_API_OPERATIONS)).toHaveLength(109);
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
        .create_or_rotate_playlist_invite_api_playlists__playlist_id__invite_post,
    ).toEqual({
      method: 'POST',
      path: '/api/playlists/{playlist_id}/invite',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [201],
    });
    expect(
      GENERATED_API_OPERATIONS.preview_playlist_invite_api_playlists_invites__token__get,
    ).toEqual({
      method: 'GET',
      path: '/api/playlists/invites/{token}',
      auth: 'required',
      requestMediaTypes: [],
      successStatuses: [200],
    });
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
        artist: string;
        deezer_id?: string | null;
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
