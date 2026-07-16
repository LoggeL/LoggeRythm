import { useSyncExternalStore } from 'react';
import {
  getOfflineSnapshot,
  subscribeOfflineDownloads,
  type OfflineRuntimeSnapshot,
} from './registry';

export function useOfflineDownloads(): OfflineRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeOfflineDownloads,
    getOfflineSnapshot,
    getOfflineSnapshot,
  );
}
