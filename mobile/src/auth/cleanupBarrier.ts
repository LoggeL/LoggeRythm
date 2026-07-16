/**
 * Retains an incomplete account boundary across React renders and retry attempts.
 * A null scope means "enumerate every registered account key"; once a concrete
 * scope is known, later null callers must not discard it.
 */
export class AccountCleanupBarrier {
  private required = false;
  private retainedScope: string | null = null;

  require(accountScope: string | null): void {
    this.required = true;
    if (accountScope !== null) this.retainedScope = accountScope;
  }

  complete(): void {
    this.required = false;
    this.retainedScope = null;
  }

  get needsCleanup(): boolean {
    return this.required;
  }

  get accountScope(): string | null {
    return this.retainedScope;
  }
}

/**
 * Invalidates asynchronous identity reads before they can commit after a
 * logout, authoritative 401, account switch, or successful account deletion.
 * The numeric ticket is intentionally process-local: durable state is erased
 * by the account cleanup boundary, while this barrier closes in-flight races.
 */
export class AuthCommitBarrier {
  private revision = 0;

  capture(): number {
    return this.revision;
  }

  invalidate(): void {
    this.revision += 1;
  }

  assertCurrent(revision: number): void {
    if (revision !== this.revision) {
      throw new Error('Authentication result was invalidated by account cleanup');
    }
  }
}
