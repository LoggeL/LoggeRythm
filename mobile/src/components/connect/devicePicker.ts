export type DevicePickerInitialFocus = 'devices' | 'jam';

export interface DevicePickerRequest {
  readonly requestId: number;
  readonly initialFocus: DevicePickerInitialFocus;
}

let sequence = 0;
let activeRequest: DevicePickerRequest | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeDevicePicker(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDevicePickerRequest(): DevicePickerRequest | null {
  return activeRequest;
}

export function showDevicePicker(initialFocus: DevicePickerInitialFocus = 'devices'): void {
  activeRequest = Object.freeze({ requestId: ++sequence, initialFocus });
  publish();
}

export function dismissDevicePicker(requestId?: number): void {
  if (requestId !== undefined && activeRequest?.requestId !== requestId) return;
  if (activeRequest === null) return;
  activeRequest = null;
  publish();
}
