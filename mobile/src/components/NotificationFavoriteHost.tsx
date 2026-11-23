import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { strings } from '../localization';
import { reportPlayerError } from '../player/errors';
import { syncNativeLikedTrackIds } from '../player/favoriteNativePort';
import { ensurePlayer } from '../player/setup';

interface AccountFavoriteSyncProps {
  scope: string;
}

function AccountFavoriteSync({ scope }: AccountFavoriteSyncProps) {
  const likes = useQuery({
    ...musicQueries.likes(scope),
  });

  const likedTrackIdsKey = useMemo(() => {
    if (likes.data === undefined) return null;
    const unique = new Set<string>();
    for (const track of likes.data) {
      unique.add(String(track.id));
    }
    return [...unique].sort().join(',');
  }, [likes.data]);

  useEffect(() => {
    if (likedTrackIdsKey === null) return undefined;
    const ids = likedTrackIdsKey.length === 0 ? [] : likedTrackIdsKey.split(',');
    let cancelled = false;
    void ensurePlayer(scope)
      .then(() => {
        if (cancelled) return undefined;
        return syncNativeLikedTrackIds(ids);
      })
      .catch((cause) => {
        if (!cancelled) reportPlayerError(strings.player.likeFailed, cause);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, likedTrackIdsKey]);

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
