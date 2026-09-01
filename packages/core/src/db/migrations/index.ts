import { baseline } from './0001_baseline.js';
import { settings } from './0002_settings.js';
import { analytics } from './0003_analytics.js';
import { userIndexes } from './0004_user_indexes.js';
import { analyticsV2 } from './0005_analytics_v2.js';
import { analyticsIp } from './0006_analytics_ip.js';
import { usenet } from './0007_usenet.js';
import { usenetMetrics } from './0008_usenet_metrics.js';
import { usenetLibraryExt } from './0009_usenet_library_ext.js';
import { usenetLibraryPassword } from './0010_usenet_library_password.js';
import { usenetSpeed } from './0011_usenet_speed.js';
import { usenetLibraryAliases } from './0012_usenet_library_aliases.js';
import { releaseBlocklist } from './0013_release_blocklist.js';
import { releaseBlocklistPublish } from './0014_release_blocklist_publish.js';
import { usenetLatency } from './0015_usenet_latency.js';
import { usenetIndexerMetrics } from './0016_usenet_indexer_metrics.js';
import { streamSessions } from './0017_stream_sessions.js';
import { taskState } from './0018_task_state.js';
import { configProfiles } from './0019_config_profiles.js';
import { animeDatabase } from './0020_anime_database.js';
import { analyticsIndexes } from './0021_analytics_indexes.js';
import { animeBuildSources } from './0022_anime_build_sources.js';
import { linkedAccounts } from './0023_linked_accounts.js';

// ---------------------------------------------------------------------------
// Fork-only migrations (ids 9000+)
//
// This fork (aghermida/AIOStreams) nightly-merges upstream's main branch
// (github.com/Viren070/AIOStreams) via `.github/workflows/docker.yml`. That
// merge aborts and fails loudly on any conflict — it does not auto-resolve.
// Upstream numbers its own migrations sequentially from 1 with no awareness
// of this fork; two migrations sharing the same numeric id is a hard
// collision (duplicate `_migrations` PRIMARY KEY / git merge conflict here).
//
// To make that class of collision structurally impossible, every fork-only
// migration reserves the id range starting at 9000:
//   - Next new fork-only migration: id 9002, filename 9002_<name>.ts.
//   - Increment by 1 per fork-only migration after that.
//   - NEVER reuse, lower, or renumber into upstream's range (currently low
//     double digits, growing roughly one migration every few days).
//   - Gaps between upstream's range and 9000 are fine — the runner only
//     requires globally unique ids and correct array order, not
//     contiguity (see runner.ts).
// ---------------------------------------------------------------------------
import { userLabel } from './9000_user_label.js';
import { configEscrow } from './9001_config_escrow.js';
import { dropUserLabelAndEscrow } from './9002_drop_user_label_and_escrow.js';
import type { Migration } from './types.js';

export const MIGRATIONS: readonly Migration[] = [
  baseline,
  settings,
  analytics,
  userIndexes,
  analyticsV2,
  analyticsIp,
  usenet,
  usenetMetrics,
  usenetLibraryExt,
  usenetLibraryPassword,
  usenetSpeed,
  usenetLibraryAliases,
  releaseBlocklist,
  releaseBlocklistPublish,
  usenetLatency,
  usenetIndexerMetrics,
  streamSessions,
  taskState,
  configProfiles,
  animeDatabase,
  analyticsIndexes,
  animeBuildSources,
  linkedAccounts,
  userLabel,
  configEscrow,
  dropUserLabelAndEscrow,
];

export type { Migration } from './types.js';
