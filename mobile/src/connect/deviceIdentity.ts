import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';
import type { ConnectDeviceType } from '../api/types';
import { isTvMode } from '../tv/tvEnvironment';
import { MOBILE_CONNECT_CAPABILITIES, validateConnectDeviceName } from './connectModel';

export { MOBILE_CONNECT_CAPABILITIES, validateConnectDeviceName };

export const CONNECT_DEVICE_ID_STORAGE_KEY = 'lr.connect.deviceId.v1';
export const CONNECT_DEVICE_NAME_STORAGE_KEY = 'lr.connect.deviceName.v1';
export const CONNECT_ENABLED_STORAGE_KEY = 'lr.connect.enabled.v1';

export interface ConnectDeviceIdentity {
  readonly deviceId: string;
  readonly name: string;
  readonly deviceType: ConnectDeviceType;
  readonly enabled: boolean;
}

export interface ConnectIdentityStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const UUID_V4_HEX = '0123456789abcdef';

export function generateConnectDeviceId(): string {
  const cryptoObj = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (arr: Uint8Array) => Uint8Array }
    | undefined;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += UUID_V4_HEX[bytes[i] >> 4] + UUID_V4_HEX[bytes[i] & 0x0f];
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function detectMobileDeviceType(
  options: {
    isTv?: boolean;
    os?: string;
    isPad?: boolean;
    dimensions?: { width: number; height: number };
  } = {},
): ConnectDeviceType {
  const tv = options.isTv ?? isTvMode();
  if (tv) return 'tv';
  const os = options.os ?? Platform.OS;
  const isPad = options.isPad ?? ((Platform as { isPad?: unknown }).isPad === true);
  if (os === 'ios' && isPad) return 'tablet';
  const dims = options.dimensions ?? Dimensions.get('window');
  if (
    Number.isFinite(dims.width)
    && Number.isFinite(dims.height)
    && Math.min(dims.width, dims.height) >= 600
  ) {
    return 'tablet';
  }
  return 'mobile';
}

export function defaultMobileDeviceName(
  deviceType: ConnectDeviceType,
  options: {
    os?: string;
    constants?: Record<string, unknown>;
  } = {},
): string {
  const os = options.os ?? Platform.OS;
  const constants =
    options.constants ?? ((Platform as { constants?: Record<string, unknown> }).constants ?? {});
  if (os === 'android') {
    const model = typeof constants.Model === 'string' ? constants.Model.trim() : '';
    const brand = typeof constants.Brand === 'string' ? constants.Brand.trim() : '';
    if (model.length > 0) {
      if (brand.length > 0 && !model.toLowerCase().startsWith(brand.toLowerCase())) {
        const prettyBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
        return `${prettyBrand} ${model}`;
      }
      return model;
    }
    if (deviceType === 'tv') return 'Android TV';
    if (deviceType === 'tablet') return 'Android Tablet';
    return 'Android Phone';
  }
  if (os === 'ios') {
    if (deviceType === 'tablet') return 'iPad';
    return 'iPhone';
  }
  if (deviceType === 'tv') return 'LoggeRythm TV';
  if (deviceType === 'tablet') return 'LoggeRythm Tablet';
  return 'LoggeRythm Mobile';
}

export async function loadConnectDeviceIdentity(
  storage: ConnectIdentityStorage = AsyncStorage,
): Promise<ConnectDeviceIdentity> {
  const deviceType = detectMobileDeviceType();
  const [storedId, storedName, storedEnabled] = await Promise.all([
    storage.getItem(CONNECT_DEVICE_ID_STORAGE_KEY),
    storage.getItem(CONNECT_DEVICE_NAME_STORAGE_KEY),
    storage.getItem(CONNECT_ENABLED_STORAGE_KEY),
  ]);

  let deviceId = storedId?.trim() ?? '';
  if (deviceId.length === 0) {
    deviceId = generateConnectDeviceId();
    await storage.setItem(CONNECT_DEVICE_ID_STORAGE_KEY, deviceId);
  }

  let name = storedName?.trim() ?? '';
  if (name.length === 0) {
    name = defaultMobileDeviceName(deviceType);
  }

  let enabled = true;
  if (storedEnabled !== null) {
    if (storedEnabled === 'true') enabled = true;
    else if (storedEnabled === 'false') enabled = false;
    else {
      throw new Error(`Stored Connect enabled flag is invalid: ${storedEnabled}`);
    }
  }

  return Object.freeze({ deviceId, name, deviceType, enabled });
}

export async function saveConnectDeviceName(
  name: string,
  storage: ConnectIdentityStorage = AsyncStorage,
): Promise<string> {
  const validated = validateConnectDeviceName(name);
  await storage.setItem(CONNECT_DEVICE_NAME_STORAGE_KEY, validated);
  return validated;
}

export async function saveConnectEnabled(
  enabled: boolean,
  storage: ConnectIdentityStorage = AsyncStorage,
): Promise<void> {
  await storage.setItem(CONNECT_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}
