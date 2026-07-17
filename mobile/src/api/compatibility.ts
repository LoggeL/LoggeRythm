import {
  API_COMPATIBILITY_OPERATION,
  GENERATED_OPENAPI_CONTRACT_VERSION,
  type ApiCompatibilityWire,
} from './generated/contract';
import { compatibilityMessages } from './compatibilityMessages';

const COMPATIBILITY_TIMEOUT_MS = 5_000;
const API_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CONTRACT_VERSION_PATTERN = /^v[1-9]\d*$/;

type CompatibilityFetch = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeApiCompatibility(value: unknown): ApiCompatibilityWire {
  if (!isRecord(value)) throw new Error('compatibility response must be an object');

  const apiVersion = value.api_version;
  const currentContract = value.current_contract_version;
  const compatibleContracts = value.compatible_contract_versions;

  if (typeof apiVersion !== 'string' || !API_VERSION_PATTERN.test(apiVersion)) {
    throw new Error('api_version must be a semantic version');
  }
  if (typeof currentContract !== 'string' || !CONTRACT_VERSION_PATTERN.test(currentContract)) {
    throw new Error('current_contract_version must be a versioned contract name');
  }
  if (
    !Array.isArray(compatibleContracts) ||
    compatibleContracts.length === 0 ||
    !compatibleContracts.every(
      (contract): contract is string =>
        typeof contract === 'string' && CONTRACT_VERSION_PATTERN.test(contract),
    )
  ) {
    throw new Error('compatible_contract_versions must be a non-empty contract list');
  }
  if (new Set(compatibleContracts).size !== compatibleContracts.length) {
    throw new Error('compatible_contract_versions must not contain duplicates');
  }
  if (!compatibleContracts.includes(currentContract)) {
    throw new Error('compatible_contract_versions must include the current contract');
  }

  return {
    api_version: apiVersion,
    current_contract_version: currentContract,
    compatible_contract_versions: compatibleContracts,
  };
}

export class UnsupportedServerError extends Error {
  readonly appContractVersion = GENERATED_OPENAPI_CONTRACT_VERSION;
  readonly serverContractVersions: readonly string[];

  constructor(serverContractVersions: readonly string[] = []) {
    super(
      compatibilityMessages.unsupportedServer(
        GENERATED_OPENAPI_CONTRACT_VERSION,
        serverContractVersions,
      ),
    );
    this.name = 'UnsupportedServerError';
    this.serverContractVersions = [...serverContractVersions];
  }
}

export class ServerCompatibilityCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerCompatibilityCheckError';
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/**
 * Per-origin preflight gate for every API/media request.
 *
 * Successful and definitively incompatible responses are cached for this
 * process, so an old server fails once and cannot repeatedly mutate request or
 * auth state. Network/5xx failures are intentionally evicted so Retry works.
 */
export class ApiCompatibilityGate {
  private readonly checks = new Map<string, Promise<ApiCompatibilityWire>>();

  constructor(
    private readonly fetchImpl?: CompatibilityFetch,
    private readonly timeoutMs = COMPATIBILITY_TIMEOUT_MS,
  ) {}

  ensureCompatible(apiBase: string): Promise<ApiCompatibilityWire> {
    const origin = new URL(apiBase).origin;
    const existing = this.checks.get(origin);
    if (existing !== undefined) return existing;

    const check = this.performCheck(origin);
    this.checks.set(origin, check);
    void check.catch((error: unknown) => {
      if (
        error instanceof ServerCompatibilityCheckError &&
        this.checks.get(origin) === check
      ) {
        this.checks.delete(origin);
      }
    });
    return check;
  }

  clear(): void {
    this.checks.clear();
  }

  forget(apiBase: string): void {
    this.checks.delete(new URL(apiBase).origin);
  }

  private async performCheck(origin: string): Promise<ApiCompatibilityWire> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      const request = this.fetchImpl ?? globalThis.fetch;
      response = await request(`${origin}${API_COMPATIBILITY_OPERATION.path}`, {
        method: API_COMPATIBILITY_OPERATION.method,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new ServerCompatibilityCheckError(
        controller.signal.aborted
          ? compatibilityMessages.checkTimedOut
          : compatibilityMessages.networkFailed,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status)) {
        throw new ServerCompatibilityCheckError(
          compatibilityMessages.serverUnavailable(response.status),
        );
      }
      throw new UnsupportedServerError();
    }

    let decoded: ApiCompatibilityWire;
    try {
      decoded = decodeApiCompatibility(await response.json());
    } catch {
      throw new UnsupportedServerError();
    }

    if (!decoded.compatible_contract_versions.includes(GENERATED_OPENAPI_CONTRACT_VERSION)) {
      throw new UnsupportedServerError(decoded.compatible_contract_versions);
    }
    return decoded;
  }
}

const compatibilityGate = new ApiCompatibilityGate();

export function ensureApiCompatibility(apiBase: string): Promise<ApiCompatibilityWire> {
  return compatibilityGate.ensureCompatible(apiBase);
}

/** A fresh signed-out submit may retry a server that was upgraded in-process. */
export function resetApiCompatibilityCheck(apiBase: string): void {
  compatibilityGate.forget(apiBase);
}
