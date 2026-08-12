import type { Migration } from './types.js';

/**
 * Server-recoverable copy of each user's config, encrypted with the
 * instance secret key alone (not derived from the user's password) - the
 * same primitive already used for the `encryptedPassword` token embedded in
 * every install URL. Lets an admin force-reset a forgotten password without
 * needing the old one, since the config itself never depended on it to
 * begin with. Additive, nullable - existing rows populate it on their next
 * save.
 */
export const configEscrow: Migration = {
  id: 21,
  name: 'config_escrow',
  up: {
    sqlite: `
      ALTER TABLE users ADD COLUMN config_escrow TEXT;
    `,
    postgres: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS config_escrow TEXT;
    `,
  },
};
