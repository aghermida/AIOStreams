import type { Dialect } from '../driver/types.js';

export interface Migration {
  /**
   * Monotonic version number, applied in ascending order (array order in
   * index.ts governs actual apply order — see runner.ts).
   *
   * This fork nightly-merges upstream (Viren070/AIOStreams), which owns
   * ids starting at 1 with organic sequential growth. Fork-only migrations
   * must never use upstream's range: start at 9000 and increment by 1 for
   * each new fork-only migration. See the "Fork-only migrations" block at
   * the top of index.ts for the full rationale.
   */
  readonly id: number;
  /** Human-readable name (used in logs and the `_migrations` table). */
  readonly name: string;
  /** DDL/DML per dialect. Both are required so missing one is a build error. */
  readonly up: Record<Dialect, string>;
}
