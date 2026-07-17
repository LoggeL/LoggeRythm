import { describe, expect, expectTypeOf, it } from 'vitest';
import contract from '../../../../contracts/listening-stats.v2.json';
import type {
  GeneratedApiResponse,
  UserStatsWire,
} from '../../api/generated/contract';
import {
  decodeListeningStatsWire,
  mapListeningStatsWire,
  type ListeningStatsWire,
} from './listeningStats';

describe('listening stats v2 wire-to-domain contract', () => {
  it('is compile-time bound to the generated operation response model', () => {
    expectTypeOf<ListeningStatsWire>().toEqualTypeOf<
      GeneratedApiResponse<'get_stats_api_me_stats_get'>
    >();
    expectTypeOf<ListeningStatsWire>().toEqualTypeOf<UserStatsWire>();
  });

  it('maps every shared valid fixture exactly', () => {
    expect(contract.$id).toBe('loggerythm.listening-stats.v2');
    expect(contract.version).toBe(2);
    for (const fixture of contract.valid) {
      expect(
        mapListeningStatsWire(decodeListeningStatsWire(fixture.wire)),
        fixture.id,
      ).toStrictEqual(fixture.domain);
    }
  });

  it('rejects every shared invalid fixture with field-level context', () => {
    for (const fixture of contract.invalid) {
      expect(
        () => mapListeningStatsWire(decodeListeningStatsWire(fixture.wire)),
        fixture.id,
      ).toThrow(fixture.error);
    }
  });

  it('enforces the shared recent-artist collection bound', () => {
    const populated = contract.valid.find(
      (fixture) => fixture.id === 'legacy-ids-and-missing-optional-media',
    );
    if (populated === undefined) throw new Error('missing populated stats fixture');
    const wire = structuredClone(populated.wire);
    wire.recent[0].artists = Array.from(
      { length: contract.limits.recent_artists + 1 },
      (_, index) => ({ id: index, name: `Artist ${index}` }),
    );

    expect(() => decodeListeningStatsWire(wire)).toThrow('recent[0].artists');
  });

  it('does not manufacture complete Track-only fields for recent history', () => {
    const populated = contract.valid.find(
      (fixture) => fixture.id === 'legacy-ids-and-missing-optional-media',
    );
    if (populated === undefined) throw new Error('missing populated stats fixture');
    const recent = mapListeningStatsWire(
      decodeListeningStatsWire(populated.wire),
    ).recent[0];

    expect(recent).toMatchObject({ id: '3135556', cover: '', duration_sec: 224 });
    expect('preview_url' in recent).toBe(false);
    expect('rank' in recent).toBe(false);
    expect('release_date' in recent).toBe(false);
  });
});
