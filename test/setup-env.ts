import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Loads the test environment (db_test on port 5433) into every e2e worker. */
config({ path: resolve(__dirname, '..', '.env.test'), override: true, quiet: true });
