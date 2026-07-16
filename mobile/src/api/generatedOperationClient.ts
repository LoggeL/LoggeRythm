import { apiRequest } from './client';
import {
  GENERATED_API_OPERATIONS,
  type GeneratedApiOperationId,
  type GeneratedApiRequest,
  type GeneratedApiResponse,
} from './generated/contract';

type RuntimeRequest = Record<string, unknown>;

export interface GeneratedOperationRequestOptions<
  OperationId extends GeneratedApiOperationId,
> {
  readonly request: GeneratedApiRequest<OperationId>;
  readonly decode: (value: unknown) => GeneratedApiResponse<OperationId>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export class GeneratedOperationRequestError extends Error {
  readonly operationId: GeneratedApiOperationId;

  constructor(operationId: GeneratedApiOperationId, message: string) {
    super(`${operationId}: ${message}`);
    this.name = 'GeneratedOperationRequestError';
    this.operationId = operationId;
  }
}

function requestObject(
  operationId: GeneratedApiOperationId,
  value: unknown,
): RuntimeRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeneratedOperationRequestError(operationId, 'request must be an object');
  }
  return value as RuntimeRequest;
}

function requestSection(
  operationId: GeneratedApiOperationId,
  request: RuntimeRequest,
  section: string,
): RuntimeRequest | undefined {
  const value = request[section];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeneratedOperationRequestError(
      operationId,
      `request.${section} must be an object when present`,
    );
  }
  return value as RuntimeRequest;
}

function encodedScalar(
  operationId: GeneratedApiOperationId,
  path: string,
  value: unknown,
): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return encodeURIComponent(String(value));
  }
  throw new GeneratedOperationRequestError(
    operationId,
    `${path} must be a string, number, or boolean`,
  );
}

function renderPath(
  operationId: GeneratedApiOperationId,
  template: string,
  pathValues: RuntimeRequest | undefined,
): string {
  const placeholders = [...template.matchAll(/{([^{}]+)}/g)].map((match) => match[1]);
  if (placeholders.length === 0) {
    if (pathValues !== undefined && Object.keys(pathValues).length > 0) {
      throw new GeneratedOperationRequestError(
        operationId,
        'request.path was provided for an operation without path parameters',
      );
    }
    return template;
  }
  if (pathValues === undefined) {
    throw new GeneratedOperationRequestError(operationId, 'request.path is required');
  }
  const extras = Object.keys(pathValues).filter((name) => !placeholders.includes(name));
  if (extras.length > 0) {
    throw new GeneratedOperationRequestError(
      operationId,
      `request.path contains unknown parameters: ${extras.join(', ')}`,
    );
  }
  return placeholders.reduce((path, name) => {
    if (!(name in pathValues)) {
      throw new GeneratedOperationRequestError(
        operationId,
        `request.path.${name} is required`,
      );
    }
    return path.replace(
      `{${name}}`,
      encodedScalar(operationId, `request.path.${name}`, pathValues[name]),
    );
  }, template);
}

function appendQuery(
  operationId: GeneratedApiOperationId,
  path: string,
  query: RuntimeRequest | undefined,
): string {
  if (query === undefined) return path;
  const values: string[] = [];
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    values.push(
      `${encodeURIComponent(name)}=${encodedScalar(operationId, `request.query.${name}`, value)}`,
    );
  }
  return values.length === 0 ? path : `${path}?${values.join('&')}`;
}

/**
 * Execute a JSON OpenAPI operation through the existing strict mobile transport.
 *
 * Paths, methods, auth mode, and accepted success statuses come from the
 * generated descriptor. Response validation stays explicit and human-owned.
 * Session cookies remain owned by `apiRequest`; callers may not inject them.
 */
export function requestGeneratedOperation<OperationId extends GeneratedApiOperationId>(
  operationId: OperationId,
  options: GeneratedOperationRequestOptions<OperationId>,
): Promise<GeneratedApiResponse<OperationId>> {
  const descriptor = GENERATED_API_OPERATIONS[operationId];
  const request = requestObject(operationId, options.request);
  const explicitCookie = requestSection(operationId, request, 'cookie');
  if (explicitCookie !== undefined) {
    throw new GeneratedOperationRequestError(
      operationId,
      'request.cookie is forbidden; the authenticated session is centrally managed',
    );
  }
  const requestMediaTypes = descriptor.requestMediaTypes as readonly string[];
  if (
    request.body !== undefined
    && !requestMediaTypes.includes('application/json')
  ) {
    throw new GeneratedOperationRequestError(
      operationId,
      `runtime adapter supports only application/json bodies, received ${
        requestMediaTypes.length === 0 ? 'no declared media type' : requestMediaTypes.join(', ')
      }`,
    );
  }

  const path = appendQuery(
    operationId,
    renderPath(operationId, descriptor.path, requestSection(operationId, request, 'path')),
    requestSection(operationId, request, 'query'),
  );
  return apiRequest<GeneratedApiResponse<OperationId>>(path, {
    method: descriptor.method,
    ...(request.body === undefined ? {} : { body: request.body }),
    decode: options.decode,
    noAuth: descriptor.auth === 'none',
    signal: options.signal,
    successStatuses: descriptor.successStatuses,
    timeoutMs: options.timeoutMs,
  });
}
