import { describe, expect, it, vi } from 'vitest';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  isExpectedAudioMetaAbsence,
  LiveWaveformScrubber,
  sampleWaveformPeaks,
  unexpectedAudioMetaErrorMessage,
  WaveformScrubberView,
} from './WaveformScrubber';

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useMemo: <T,>(factory: () => T) => factory(),
}));
vi.mock('react-native', () => ({
  PanResponder: { create: (config: unknown) => ({ panHandlers: config }) },
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: queryMock.useQuery }));
vi.mock('../../hooks/useHaptics', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../../data', () => ({ musicQueries: { audioMeta: vi.fn() } }));

describe('WaveformScrubber', () => {
  it('deterministically resamples 96 peaks without fabricating peaks for empty arrays', () => {
    expect(sampleWaveformPeaks([])).toEqual([]);
    const raw = Array.from({ length: 96 }, (_, i) => (i % 10) / 10);
    const sampled = sampleWaveformPeaks(raw, 32);
    expect(sampled).toHaveLength(32);
    expect(sampled.every((v) => v >= 0.08 && v <= 1)).toBe(true);
  });

  it('renders waveform bars and BPM/LUFS badges when real peaks exist, and returns null when empty', () => {
    const emptyTree = WaveformScrubberView({
      meta: {
        deezer_id: '42',
        peaks: [],
        loudness_lufs: null,
        loudness_gain_db: null,
        loudness_peak: null,
        bpm: null,
        duration_sec: 180,
        intro_end_sec: null,
        outro_start_sec: null,
        analyzed_at: '2026-11-25T00:00:00Z',
      },
      position: 30,
      duration: 180,
      onPositionChange: vi.fn(),
      onSeek: vi.fn(),
    });
    expect(emptyTree).toBeNull();

    const tree = WaveformScrubberView({
      meta: {
        deezer_id: '42',
        peaks: [0.2, 0.5, 0.8, 1.0, 0.6, 0.3],
        loudness_lufs: -9.4,
        loudness_gain_db: -4.6,
        loudness_peak: 0.98,
        bpm: 124,
        duration_sec: 180,
        intro_end_sec: 12,
        outro_start_sec: 168,
        analyzed_at: '2026-11-25T00:00:00Z',
      },
      position: 90,
      duration: 180,
      onPositionChange: vi.fn(),
      onSeek: vi.fn(),
    });
    expect(queryByTestId(tree, 'now-playing-waveform')).not.toBeNull();
    const metaText = textContent(byTestId(tree, 'now-playing-waveform-meta')).join(' ');
    expect(metaText).toContain('124 BPM');
    expect(metaText).toContain('-9.4 LUFS');
  });

  it('keeps 404/503 analysis absence quiet while surfacing unexpected 500/decode errors loudly', () => {
    expect(isExpectedAudioMetaAbsence({ status: 404 })).toBe(true);
    expect(isExpectedAudioMetaAbsence({ status: 503 })).toBe(true);
    expect(isExpectedAudioMetaAbsence({ status: 500 })).toBe(false);
    expect(isExpectedAudioMetaAbsence(new Error('Invalid audio meta shape'))).toBe(false);

    expect(unexpectedAudioMetaErrorMessage({ status: 404 })).toBeNull();
    expect(unexpectedAudioMetaErrorMessage({ status: 503 })).toBeNull();
    expect(unexpectedAudioMetaErrorMessage(new Error('HTTP 502 Bad Gateway'))).toContain(
      'HTTP 502 Bad Gateway',
    );

    queryMock.useQuery.mockReturnValueOnce({ data: undefined, error: { status: 404 } });
    expect(
      LiveWaveformScrubber({
        trackId: '42',
        position: 10,
        duration: 180,
        onPositionChange: vi.fn(),
        onSeek: vi.fn(),
      }),
    ).toBeNull();

    queryMock.useQuery.mockReturnValueOnce({
      data: undefined,
      error: new Error('Invalid JSON payload'),
    });
    const errorTree = LiveWaveformScrubber({
      trackId: '42',
      position: 10,
      duration: 180,
      onPositionChange: vi.fn(),
      onSeek: vi.fn(),
    });
    const alert = byTestId(errorTree, 'now-playing-waveform-error');
    expect(alert.props.accessibilityRole).toBe('alert');
    expect(textContent(alert).join(' ')).toContain('Invalid JSON payload');
  });
});
