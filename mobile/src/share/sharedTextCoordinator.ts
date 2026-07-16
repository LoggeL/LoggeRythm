export const PENDING_SHARED_TEXT_STORAGE_KEY = 'lr.pending-shared-text.v1';

const PENDING_VERSION = 1;
const MAX_SHARED_TEXT_LENGTH = 8_192;

interface PendingSharedText {
  version: typeof PENDING_VERSION;
  id: string;
  text: string;
}

export interface SharedTextCoordinatorStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type SharedTextCoordinatorPhase =
  | 'hydrate'
  | 'decode'
  | 'persist'
  | 'consume'
  | 'restore'
  | 'route'
  | 'deliver';

export interface SharedTextCoordinatorOptions {
  storage: SharedTextCoordinatorStorage;
  deliver: (text: string, accountScope: string) => void;
  createId?: () => string;
  onError?: (phase: SharedTextCoordinatorPhase, error: unknown) => void;
}

interface NavigatorOwner {
  token: symbol;
  accountScope: string;
  openSearch: () => boolean;
}

interface SearchOwner {
  token: symbol;
  accountScope: string;
}

let runtimeIdSequence = 0;

function defaultId(): string {
  runtimeIdSequence += 1;
  return `${Date.now().toString(36)}-${runtimeIdSequence.toString(36)}`;
}

function normalizedScope(value: string): string {
  const scope = value.trim();
  if (scope.length === 0) throw new Error('Shared-text account scope must not be empty');
  return scope;
}

function normalizedText(value: string): string {
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_SHARED_TEXT_LENGTH) {
    throw new Error('Shared text must be non-empty and at most 8192 characters');
  }
  return text;
}

function decodePending(raw: string): PendingSharedText {
  const value = JSON.parse(raw) as Partial<PendingSharedText> | null;
  if (
    value === null ||
    value.version !== PENDING_VERSION ||
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.text !== 'string'
  ) {
    throw new Error('Pending shared text has an unsupported shape');
  }
  return {
    version: PENDING_VERSION,
    id: value.id,
    text: normalizedText(value.text),
  };
}

function encodePending(pending: PendingSharedText): string {
  return JSON.stringify(pending);
}

/**
 * Durable coordinator for the gap between Android intent intake and an
 * account-owned Search route. Platform and React dependencies are injected so
 * the gate, account-switch, and cold-start state machine stays deterministic.
 */
export class SharedTextCoordinator {
  private readonly storage: SharedTextCoordinatorStorage;
  private readonly deliver: (text: string, accountScope: string) => void;
  private readonly createId: () => string;
  private readonly onError: (phase: SharedTextCoordinatorPhase, error: unknown) => void;
  private hydrated = false;
  private pending: PendingSharedText | null = null;
  private navigator: NavigatorOwner | null = null;
  private searchOwner: SearchOwner | null = null;
  private readonly routeRequests = new Set<string>();
  private tail: Promise<void> = Promise.resolve();

  constructor({ storage, deliver, createId = defaultId, onError = () => undefined }: SharedTextCoordinatorOptions) {
    this.storage = storage;
    this.deliver = deliver;
    this.createId = createId;
    this.onError = onError;
  }

  hydrate(): Promise<void> {
    return this.enqueue(async () => {
      await this.hydrateInternal();
      await this.evaluate();
    });
  }

  stage(text: string): Promise<void> {
    return this.enqueue(async () => {
      const normalized = normalizedText(text);
      await this.hydrateInternal();
      if (this.pending?.text === normalized) {
        await this.evaluate();
        return;
      }

      const pending: PendingSharedText = {
        version: PENDING_VERSION,
        id: this.createId(),
        text: normalized,
      };
      this.pending = pending;
      this.routeRequests.clear();
      try {
        await this.storage.setItem(PENDING_SHARED_TEXT_STORAGE_KEY, encodePending(pending));
      } catch (error) {
        // Keep current-process intake useful even if persistence is temporarily
        // unavailable. Delivery still removes the durable key before publish.
        this.onError('persist', error);
      }
      await this.evaluate();
    });
  }

  /** Register only after NavigationContainer has reported ready. */
  attachNavigator(accountScope: string, openSearch: () => boolean): () => void {
    const owner: NavigatorOwner = {
      token: Symbol('shared-text-navigator'),
      accountScope: normalizedScope(accountScope),
      openSearch,
    };
    this.navigator = owner;
    void this.enqueue(async () => {
      await this.hydrateInternal();
      await this.evaluate();
    });

    return () => {
      if (this.navigator?.token === owner.token) this.navigator = null;
    };
  }

  /** Register only while the Search route is the focused route for this account. */
  attachSearchOwner(accountScope: string): () => void {
    const owner: SearchOwner = {
      token: Symbol('shared-text-search-owner'),
      accountScope: normalizedScope(accountScope),
    };
    this.searchOwner = owner;
    void this.enqueue(async () => {
      await this.hydrateInternal();
      await this.evaluate();
    });

    return () => {
      if (this.searchOwner?.token === owner.token) this.searchOwner = null;
    };
  }

  /** Test/diagnostic barrier: resolves after all coordinator work is settled. */
  async whenIdle(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.tail;
      await observed;
    } while (observed !== this.tail);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async hydrateInternal(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    let raw: string | null;
    try {
      raw = await this.storage.getItem(PENDING_SHARED_TEXT_STORAGE_KEY);
    } catch (error) {
      this.onError('hydrate', error);
      return;
    }
    if (raw === null) return;
    try {
      this.pending = decodePending(raw);
    } catch (error) {
      this.onError('decode', error);
      try {
        await this.storage.removeItem(PENDING_SHARED_TEXT_STORAGE_KEY);
      } catch (removeError) {
        this.onError('consume', removeError);
      }
    }
  }

  private async evaluate(): Promise<void> {
    const pending = this.pending;
    const navigator = this.navigator;
    if (pending === null || navigator === null) return;

    const owner = this.searchOwner;
    if (owner?.accountScope === navigator.accountScope) {
      await this.consumeForOwner(pending, navigator, owner);
      return;
    }

    const requestKey = `${pending.id}\u0000${navigator.accountScope}`;
    if (this.routeRequests.has(requestKey)) return;
    this.routeRequests.add(requestKey);
    try {
      if (!navigator.openSearch()) this.routeRequests.delete(requestKey);
    } catch (error) {
      this.routeRequests.delete(requestKey);
      this.onError('route', error);
    }
  }

  private async consumeForOwner(
    pending: PendingSharedText,
    navigator: NavigatorOwner,
    owner: SearchOwner,
  ): Promise<void> {
    if (this.pending?.id !== pending.id) return;
    try {
      // Delete first. Publishing before durable acknowledgement could replay a
      // server-affecting import after process recreation.
      await this.storage.removeItem(PENDING_SHARED_TEXT_STORAGE_KEY);
    } catch (error) {
      this.onError('consume', error);
      return;
    }

    if (
      this.navigator?.token !== navigator.token ||
      this.searchOwner?.token !== owner.token ||
      this.navigator.accountScope !== owner.accountScope
    ) {
      try {
        await this.storage.setItem(PENDING_SHARED_TEXT_STORAGE_KEY, encodePending(pending));
      } catch (error) {
        this.onError('restore', error);
      }
      return;
    }

    this.pending = null;
    this.routeRequests.clear();
    try {
      this.deliver(pending.text, owner.accountScope);
    } catch (error) {
      this.pending = pending;
      try {
        await this.storage.setItem(PENDING_SHARED_TEXT_STORAGE_KEY, encodePending(pending));
      } catch (restoreError) {
        this.onError('restore', restoreError);
      }
      this.onError('deliver', error);
    }
  }
}
