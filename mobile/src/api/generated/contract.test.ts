import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  API_COMPATIBILITY_OPERATION,
  GENERATED_API_OPERATIONS,
  GENERATED_OPENAPI_CONTRACT_VERSION,
  type GeneratedApiRequest,
  type GeneratedApiRequestArgs,
  type GeneratedApiResponse,
  type LoginRequestWire,
  type PlaylistEntryReorderWire,
  type UserOutWire,
} from './contract';

describe('generated OpenAPI contract', () => {
  it('describes every versioned operation and preserves compatibility metadata', () => {
    expect(Object.keys(GENERATED_API_OPERATIONS)).toHaveLength(82);
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
      };
    }>();
    expectTypeOf<GeneratedApiResponse<'delete_me_api_me_delete'>>().toEqualTypeOf<undefined>();
    expectTypeOf<GeneratedApiRequest<
      'reorder_playlist_entries_api_playlists__playlist_id__tracks_entries_order_patch'
    >>().toEqualTypeOf<{
      path: { playlist_id: number };
      body: PlaylistEntryReorderWire;
    }>();
    expectTypeOf<GeneratedApiRequestArgs<'me_api_auth_me_get'>>().toEqualTypeOf<
      [request?: Record<never, never>]
    >();
  });
});
