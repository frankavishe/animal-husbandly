import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Prepares the Dockerized test database (db_test, tmpfs-backed) once per run without destroying
 * anything: apply pending migrations, then run the idempotent seed (regions + admin).
 * Suites clean up their own rows with `resetUsers()`.
 */
export default function globalSetup(): void {
  const root = resolve(__dirname, '..');
  const env = { ...process.env };
  config({ path: resolve(root, '.env.test'), override: true, quiet: true, processEnv: env });
  if (!env.DATABASE_URL?.includes(':5433/')) {
    throw new Error('Refusing to prepare a non-test database: DATABASE_URL must point at db_test');
  }
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  execSync('npx prisma db seed', { cwd: root, env, stdio: 'pipe' });
}
