import React from 'react';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import {
  PartyNowPlayingCard,
  PartyQueueRow,
  PartySearchResultRow,
  type PartyNowPlayingCardProps,
  type PartyQueueRowProps,
  type PartySearchResultRowProps,
} from './PartyParts';

/** Connected wrapper resolving normal TrackPresentation (downloads + server cache) for NowPlayingCard. */
export function ConnectedPartyNowPlayingCard(
  props: Omit<PartyNowPlayingCardProps, 'presentation'>,
) {
  const entry = props.party.current_index >= 0 ? props.party.tracks[props.party.current_index] : undefined;
  const presentation = useTrackPresentation({
    trackId: entry?.deezer_id ?? '',
    queueContext: { type: 'party', id: props.party.code },
    originalContextOrder: props.party.current_index >= 0 ? props.party.current_index : null,
  });
  return <PartyNowPlayingCard {...props} presentation={presentation} />;
}

/** Connected wrapper for `PartyScreen` subscribing to `TrackPresentationProvider`. */
export function ConnectedPartyQueueRow(props: Omit<PartyQueueRowProps, 'presentation'>) {
  const entry = props.party.tracks[props.index];
  const presentation = useTrackPresentation({
    trackId: entry?.deezer_id ?? '',
    queueContext: { type: 'party', id: props.party.code },
    originalContextOrder: props.index,
  });
  return <PartyQueueRow {...props} presentation={presentation} />;
}

/** Connected search result row injecting normal stored/downloaded icons via TrackPresentationProvider. */
export function ConnectedPartySearchResultRow(
  props: Omit<PartySearchResultRowProps, 'presentation'>,
) {
  const presentation = useTrackPresentation({ trackId: props.track.id });
  return <PartySearchResultRow {...props} presentation={presentation} />;
}
