import type { Migration } from './types.js';

/**
 * Admin-set display nickname for a user row, shown in the dashboard Users
 * table instead of the raw uuid. Lives outside the encrypted config blob.
 * Additive, nullable - existing rows stay valid with a NULL label.
 */
export const userLabel: Migration = {
  id: 20,
  name: 'user_label',
  up: {
    sqlite: `
      ALTER TABLE users ADD COLUMN label TEXT;
    `,
    postgres: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS label TEXT;
    `,
  },
};
