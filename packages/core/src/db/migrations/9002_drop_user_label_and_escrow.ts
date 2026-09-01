import type { Migration } from './types.js';

/**
 * Drops the `label` (nickname) and `config_escrow` (admin password recovery)
 * columns added by 9000/9001 - both features were removed. This migration
 * system is forward-only (no "down"), so a fresh database still applies
 * 9000/9001 and then immediately drops what they added here.
 */
export const dropUserLabelAndEscrow: Migration = {
  id: 9002,
  name: 'drop_user_label_and_escrow',
  up: {
    sqlite: `
      ALTER TABLE users DROP COLUMN label;
      ALTER TABLE users DROP COLUMN config_escrow;
    `,
    postgres: `
      ALTER TABLE users DROP COLUMN IF EXISTS label;
      ALTER TABLE users DROP COLUMN IF EXISTS config_escrow;
    `,
  },
};
