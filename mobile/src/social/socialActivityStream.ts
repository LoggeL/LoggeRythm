import { decodeSocialActivityResponse } from '../api/decoders';
import {
  openAuthenticatedSseStream,
  type SseStreamDependencies,
  type SseStreamHandlers,
} from '../api/sseStream';
import type { SocialActivityResponse } from '../api/types';

export function openSocialActivityStream(
  handlers: SseStreamHandlers<SocialActivityResponse>,
  dependencies?: SseStreamDependencies,
): Promise<() => void> {
  return openAuthenticatedSseStream(
    '/api/social/activity/events',
    'Social activity',
    decodeSocialActivityResponse,
    handlers,
    dependencies,
  );
}
