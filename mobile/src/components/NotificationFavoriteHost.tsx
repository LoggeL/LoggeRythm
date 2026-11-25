import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { getLikedTrackIndex, isTrackLiked } from '../data/trackIdentity';
import { strings } from '../localization';
import { reportPlayerError } from '../player/errors';
import { syncNativeLikedTrackIds } from '../player/favoriteNativePort';
import { mediaItemToTrack } from '../player/mediaItem';
import Player, { Event, type MediaItem } from '../player/player';
import { ensurePlayer } from '../player/setup';

interface AccountFavoriteSyncProps {
  scope: string;
}

/**
 * Derive the sorted numeric track IDs for the native Media3 favorite snapshot:
 * every liked track ID plus any queued track ID whose recording (ISRC/fallback)
 * matches a liked song, so Android Auto / lockscreen hearts match across Singles,
 * EPs, Albums, and Deluxe editions.
 */
export function collectNativeLikedTrackIds(
  likes: readonly Track[],
  queueItems: readonly MediaItem[] = [],
): string[] {
  const unique = new Set<string>();
  for (const track of likes) {
    unique.add(String(track.id));
  }
  if (likes.length > 0 && queueItems.length > 0) {
    const likedIndex = getLikedTrackIndex(likes);
    for (const item of queueItems) {
      const queuedTrack = mediaItemToTrack(item);
      if (queuedTrack !== null && isTrackLiked(likedIndex, queuedTrack)) {
        unique.add(String(queuedTrack.id));
      }
    }
  }
  return [...unique].sort();
}

function AccountFavoriteSync({ scope }: AccountFavoriteSyncProps) {
  const likes = useQuery({
    ...musicQueries.likes(scope),
  });
  const [queueVersion, setQueueVersion] = useState(0);

  useEffect(() => {
    const bump = () => setQueueVersion((current) => current + 1);
    const queueSub = Player.addEventListener(Event.QueueChanged, bump);
    const transitionSub = Player.addEventListener(Event.MediaItemTransition, bump);
    return () => {
      queueSub.remove();
      transitionSub.remove();
    };
  }, []);

  const likesSnapshot = likes.data;
  const likedTrackSignature = useMemo(() => {
    if (likesSnapshot === undefined) return null;
    const unique = new Set<string>();
    for (const track of likesSnapshot) {
      unique.add(`${String(track.id)}:${track.isrc ?? ''}`);
    }
    return [...unique].sort().join(',');
  }, [likesSnapshot]);

  useEffect(() => {
    if (likedTrackSignature === null || likesSnapshot === undefined) return undefined;
    let cancelled = false;
    void ensurePlayer(scope)
      .then(() => {
        if (cancelled) return undefined;
        const ids = collectNativeLikedTrackIds(likesSnapshot, Player.getQueue());
        return syncNativeLikedTrackIds(ids);
      })
      .catch((cause) => {
        if (!cancelled) reportPlayerError(strings.player.likeFailed, cause);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, likedTrackSignature, likesSnapshot, queueVersion]);

  return null;
}

/**
 * Synchronizes the account-scoped likes cache into the native Media3 service's encrypted
 * liked-track snapshot. Native projects the current track's heart state across active playback,
 * paused playback, track transitions, backgrounding, and cold Android Auto restores without ever
 * clearing the heart button during in-flight mutations or track changes.
 */
export default function NotificationFavoriteHost() {
  const { user } = useAuth();
  if (user === null || !user.is_approved) {
    return null;
  }
  return <AccountFavoriteSync scope={musicCacheScope(getCurrentApiBase(), user.id)} />;
}
