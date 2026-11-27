import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  GeneratedApiResponse,
  WrappedReportWire,
} from '../../api/generated/contract';
import type { WrappedReport } from '../../api/types';
import {
  buildWrappedCardSvgUrl,
  decodeWrappedReport,
  WrappedContractError,
} from './wrapped';

function makeValidReport(): WrappedReport {
  return {
    range: '30d',
    generated_at: '2026-11-27T15:00:00Z',
    period_start: '2026-10-28T15:00:00Z',
    period_end: '2026-11-27T15:00:00Z',
    user: {
      display_name: 'Logge',
      avatar_url: '/api/uploads/avatars/u1.png',
    },
    totals: {
      play_count: 84,
      listening_sec: 18420,
      unique_tracks: 42,
      unique_artists: 19,
      unique_albums: 24,
      new_artists_count: 6,
      active_days: 18,
      total_days: 30,
      avg_daily_sec: 614,
      current_streak_days: 5,
      longest_streak_days: 11,
    },
    persona: {
      id: 'night_owl',
      title: 'Nachtschwärmer',
      subtitle: 'Zwischen Mitternacht und Neon',
      tagline: 'Deine stärksten Sessions laufen nach 22 Uhr.',
      emblem: 'moon_wave',
      traits: ['Peak 23 Uhr', '38 % Wochenende', '19 Artists'],
    },
    aura: {
      id: 'neon_pulse',
      title: 'Mitternachts-Signal',
      description: 'Tiefe Basslinien treffen auf späte Entdecker-Energie.',
      colors: ['#d6ff4b', '#6fe0a8', '#8f73ff'],
      mood_tags: ['Hypnotisch', 'Spät', 'Fokussiert'],
    },
    rhythm: {
      chronotype: 'night_owl',
      chronotype_label: 'Nachteule',
      peak_hour: 23,
      peak_weekday: 4,
      weekend_share_pct: 38,
      discovery_score_pct: 32,
      repeat_score_pct: 68,
      hourly_distribution: Array.from({ length: 24 }, (_, idx) => (idx === 23 ? 18 : 2)),
      weekday_distribution: [8, 10, 11, 13, 18, 14, 10],
    },
    obsession: {
      track_key: 'track-101',
      title: 'Midnight Signal',
      artist: 'Neon Drift',
      album: 'Afterhours',
      cover: 'https://cdn.example.test/cover-1.jpg',
      play_count: 19,
      listening_sec: 4180,
      share_pct: 23,
      peak_day_date: '2026-11-22',
      peak_day_plays: 7,
    },
    peak_day: {
      date: '2026-11-22',
      weekday: 6,
      play_count: 14,
      listening_sec: 3240,
      top_track_title: 'Midnight Signal',
      top_track_artist: 'Neon Drift',
      top_track_cover: 'https://cdn.example.test/cover-1.jpg',
    },
    tempo: {
      avg_bpm: 124,
      min_bpm: 92,
      max_bpm: 142,
      analyzed_plays: 51,
      vibe_label: 'Club-Puls',
    },
    equivalents: [
      { icon: 'vinyl', value: '6,8', label: 'Vinyl-LPs durchgehört' },
      { icon: 'concert', value: '3,4', label: 'Konzerte erlebt' },
    ],
    top_tracks: [
      {
        rank: 1,
        key: 'track-101',
        label: 'Midnight Signal',
        sublabel: 'Neon Drift',
        cover: 'https://cdn.example.test/cover-1.jpg',
        count: 19,
        listening_sec: 4180,
        share_pct: 23,
      },
    ],
    top_artists: [
      {
        rank: 1,
        key: 'artist-201',
        label: 'Neon Drift',
        sublabel: 'Synthwave',
        cover: '',
        count: 27,
        listening_sec: 5900,
        share_pct: 32,
      },
    ],
    top_albums: [
      {
        rank: 1,
        key: 'album-301',
        label: 'Afterhours',
        sublabel: 'Neon Drift',
        cover: 'https://cdn.example.test/cover-1.jpg',
        count: 21,
        listening_sec: 4520,
        share_pct: 25,
      },
    ],
  };
}

describe('decodeWrappedReport', () => {
  it('is compile-time compatible with the generated OpenAPI WrappedReportWire schema', () => {
    expectTypeOf<WrappedReport>().toExtend<WrappedReportWire>();
    expectTypeOf<WrappedReport>().toExtend<
      GeneratedApiResponse<'get_stats_wrapped_api_me_stats_wrapped_get'>
    >();
  });

  it('decodes a complete WrappedReport payload strictly', () => {
    const wire = makeValidReport();
    expect(decodeWrappedReport(wire)).toEqual(wire);
  });

  it('decodes a valid zero-play WrappedReport with null highlights and empty rankings', () => {
    const empty: WrappedReport = {
      ...makeValidReport(),
      range: 'all',
      period_start: null,
      totals: {
        play_count: 0,
        listening_sec: 0,
        unique_tracks: 0,
        unique_artists: 0,
        unique_albums: 0,
        new_artists_count: 0,
        active_days: 0,
        total_days: 0,
        avg_daily_sec: 0,
        current_streak_days: 0,
        longest_streak_days: 0,
      },
      persona: null,
      aura: null,
      rhythm: {
        chronotype: 'evening_viber',
        chronotype_label: 'Abend-Hörer',
        peak_hour: 0,
        peak_weekday: 0,
        weekend_share_pct: 0,
        discovery_score_pct: 0,
        repeat_score_pct: 0,
        hourly_distribution: Array(24).fill(0),
        weekday_distribution: Array(7).fill(0),
      },
      obsession: null,
      peak_day: null,
      tempo: null,
      equivalents: [],
      top_tracks: [],
      top_artists: [],
      top_albums: [],
    };
    expect(decodeWrappedReport(empty)).toEqual(empty);
  });

  it('rejects malformed fields loudly with field paths', () => {
    expect(() => decodeWrappedReport(null)).toThrow(WrappedContractError);
    expect(() => decodeWrappedReport(null)).toThrow('WrappedReport: must be an object');

    const badRange = { ...makeValidReport(), range: '24h' };
    expect(() => decodeWrappedReport(badRange)).toThrow('WrappedReport.range');

    const badHourDist = makeValidReport();
    badHourDist.rhythm.hourly_distribution = [1, 2, 3];
    expect(() => decodeWrappedReport(badHourDist)).toThrow('WrappedReport.rhythm.hourly_distribution');

    const badAuraColors = makeValidReport();
    badAuraColors.aura = { ...badAuraColors.aura!, colors: ['not-hex', '#000000', '#ffffff'] };
    expect(() => decodeWrappedReport(badAuraColors)).toThrow('WrappedReport.aura.colors[0]');

    const badTempo = makeValidReport();
    badTempo.tempo = { ...badTempo.tempo!, min_bpm: 150, max_bpm: 90 };
    expect(() => decodeWrappedReport(badTempo)).toThrow('WrappedReport.tempo.min_bpm');

    const badZeroPlays = makeValidReport();
    badZeroPlays.totals.play_count = 0;
    expect(() => decodeWrappedReport(badZeroPlays)).toThrow('totals.play_count is 0');

    const badGeneratedAt = { ...makeValidReport(), generated_at: 'not-a-date' };
    expect(() => decodeWrappedReport(badGeneratedAt)).toThrow('WrappedReport.generated_at');

    const badEmblem = makeValidReport();
    badEmblem.persona = { ...badEmblem.persona!, emblem: 'unknown' as never };
    expect(() => decodeWrappedReport(badEmblem)).toThrow('WrappedReport.persona.emblem');

    const badHour = makeValidReport();
    badHour.rhythm.peak_hour = 24;
    expect(() => decodeWrappedReport(badHour)).toThrow('WrappedReport.rhythm.peak_hour');

    const badWeekdays = makeValidReport();
    badWeekdays.rhythm.weekday_distribution = [1, 2];
    expect(() => decodeWrappedReport(badWeekdays)).toThrow('WrappedReport.rhythm.weekday_distribution');

    const badRank = makeValidReport();
    badRank.top_tracks[0].rank = 0;
    expect(() => decodeWrappedReport(badRank)).toThrow('WrappedReport.top_tracks[0].rank');

    const tooManyTracks = makeValidReport();
    tooManyTracks.top_tracks = Array.from({ length: 11 }, (_, idx) => ({
      ...tooManyTracks.top_tracks[0],
      rank: ((idx % 10) + 1),
    }));
    expect(() => decodeWrappedReport(tooManyTracks)).toThrow('WrappedReport.top_tracks');
  });

  it('builds the authenticated SVG card URL and fails on empty origin', () => {
    expect(
      buildWrappedCardSvgUrl('https://loggerythm.logge.top/', {
        range: '30d',
        template: 'receipt',
        theme: 'paper',
        format: 'story',
      }),
    ).toBe(
      'https://loggerythm.logge.top/api/me/stats/wrapped/card.svg?range=30d&template=receipt&theme=paper&format=story',
    );
    expect(() =>
      buildWrappedCardSvgUrl('   ', { range: '30d', template: 'summary', theme: 'signal' }),
    ).toThrow('server origin');
  });
});
