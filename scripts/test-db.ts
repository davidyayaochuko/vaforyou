/**
 * Points a test script at a throwaway database. Import it FIRST.
 *
 * `src/config/env.ts` reads DB_PATH once, when it is first imported, and ESM
 * evaluates every static import before the script body runs. Setting DB_PATH in
 * the body is therefore too late: the test would run against ./data/pilot.db and
 * could queue fixture posts on a real, logged-in account. dotenv never overrides
 * a variable that is already set, so this wins over `.env`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'funke-test-')), 'test.db');
