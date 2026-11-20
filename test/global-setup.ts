import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/** Resets the Dockerized test database once per run: drop, migrate, seed (regions + admin). */
export default function globalSetup(): void {
  const root = resolve(__dirname, '..');
  const env = { ...process.env };
  config({ path: resolve(root, '.env.test'), override: true, quiet: true, processEnv: env });
  execSync('npx prisma migrate reset --force', { cwd: root, env, stdio: 'pipe' });
}
