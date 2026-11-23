import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../player/player';
import {
  adjacentNowPlayingTab,
  resolveNowPlayingBackAction,
  resolveNowPlayingBody,
  resolveNowPlayingContextLabel,
  resolveTvPanelTab,
} from './nowPlayingModel';

describe('Now Playing body state', () => {
  it('does not call cold native-player hydration an empty queue', () => {
    expect(resolveNowPlayingBody(false, false)).toBe('loading');
    expect(resolveNowPlayingBody(true, false)).toBe('empty');
    expect(resolveNowPlayingBody(true, true)).toBe('content');
  });

  it('moves between adjacent fullscreen tabs without wrapping', () => {
    expect(adjacentNowPlayingTab('playing', 'next')).toBe('lyrics');
    expect(adjacentNowPlayingTab('lyrics', 'next')).toBe('similar');
    expect(adjacentNowPlayingTab('similar', 'next')).toBe('queue');
    expect(adjacentNowPlayingTab('queue', 'next')).toBe('queue');
    expect(adjacentNowPlayingTab('queue', 'previous')).toBe('similar');
    expect(adjacentNowPlayingTab('playing', 'previous')).toBe('playing');
  });

  it('steps secondary tabs back to playing on phone Back and dismisses directly on playing or TV split', () => {
    expect(resolveNowPlayingBackAction('lyrics', false)).toBe('return-to-playing');
    expect(resolveNowPlayingBackAction('similar', false)).toBe('return-to-playing');
    expect(resolveNowPlayingBackAction('queue', false)).toBe('return-to-playing');
    expect(resolveNowPlayingBackAction('playing', false)).toBe('dismiss');
    expect(resolveNowPlayingBackAction('lyrics', true)).toBe('dismiss');
    expect(resolveNowPlayingBackAction('queue', true)).toBe('dismiss');
  });

  it('maps playing stage to lyrics inside the TV split side panel', () => {
    expect(resolveTvPanelTab('playing')).toBe('lyrics');
    expect(resolveTvPanelTab('lyrics')).toBe('lyrics');
    expect(resolveTvPanelTab('similar')).toBe('similar');
    expect(resolveTvPanelTab('queue')).toBe('queue');
  });

  it('resolves the queue context label from active media item metadata and throws on corrupt context', () => {
    const legacy = (type: string) => `Legacy ${type}`;
    expect(resolveNowPlayingContextLabel(null, legacy)).toBeNull();
    expect(resolveNowPlayingContextLabel({ mediaId: '1', url: 'https://a' } as MediaItem, legacy)).toBeNull();
    expect(
      resolveNowPlayingContextLabel(
        {
          mediaId: '1',
          url: 'https://a',
          extras: {
            queueContextType: 'playlist',
            queueContextId: 'pl-1',
            queueContextLabel: 'Late Night Drive',
          },
        } as MediaItem,
        legacy,
      ),
    ).toBe('Late Night Drive');
    expect(
      resolveNowPlayingContextLabel(
        {
          mediaId: '1',
          url: 'https://a',
          extras: {
            queueContextType: 'album',
            queueContextId: 'alb-1',
          },
        } as MediaItem,
        legacy,
      ),
    ).toBe('Legacy album');
    expect(() =>
      resolveNowPlayingContextLabel(
        {
          mediaId: '1',
          url: 'https://a',
          extras: {
            queueContextType: 'playlist',
          },
        } as MediaItem,
        legacy,
      ),
    ).toThrow(/queueContextId/);
  });
});
