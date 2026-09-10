/**
 * SPEND GUARD — makes it impossible for a collector to run away with the bill.
 *
 * The usual safeguard is a daily quota cap in the Google Cloud console. That is
 * not available here: the API key belongs to a SHARED organisational project,
 * and quotas there apply project-wide — a cap set to protect this collector
 * would also throttle whoever else is using the project. So the ceiling lives
 * in our own code instead, where it constrains only us.
 *
 * Three rules:
 *
 *   1. DRY RUN IS THE DEFAULT. A collector spends nothing unless `--live` is
 *      passed. The old default was the other way round, which is the wrong way
 *      round: the dangerous option should be the one you have to ask for.
 *
 *   2. THE LEDGER IS ON DISK. A cron firing every fifteen minutes is a fresh
 *      process each time, so an in-memory counter would reset and the "daily"
 *      cap would mean nothing. The count is persisted and shared across runs.
 *
 *   3. FAILED REQUESTS STILL COUNT. Google bills for a request that returns an
 *      error. A guard that only counted successes would undercount exactly when
 *      something is going wrong in a loop.
 *
 * The ledger lives in data/.budget/ and is gitignored.
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'data', '.budget');

/**
 * Conservative default. Enough to verify an integration or run a small sample;
 * far below any real collection sweep, which has to be asked for deliberately.
 */
export const DEFAULT_DAILY_LIMIT = 200;

/** Local date, so a "day" means what the operator means by it. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Read the run mode from argv.
 *
 * `--live`      actually call the API. Without it, nothing is spent.
 * `--limit N`   raise or lower today's ceiling for this run.
 */
export function parseMode(argv = process.argv) {
  const live = argv.includes('--live');
  const i = argv.indexOf('--limit');
  const raw = i > -1 ? Number(argv[i + 1]) : NaN;
  const limit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_LIMIT;
  return { live, dryRun: !live, limit };
}

/**
 * Open the ledger for a named collector.
 *
 * `name` separates ledgers so one collector cannot exhaust another's budget.
 */
export async function openBudget(name, limit = DEFAULT_DAILY_LIMIT, options = {}) {
  // `dir` and `date` exist so the guard itself can be tested. A ceiling nobody
  // has watched hold is not a ceiling.
  const dir = options.dir ?? DIR;
  const day = options.date ?? today();
  const file = join(dir, `${name}.json`);
  const log = join(dir, `${name}.log`);
  await mkdir(dir, { recursive: true });

  let state = { date: day, spent: 0 };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    // a ledger from a previous day starts over
    if (parsed.date === state.date) state = parsed;
  } catch {
    // no ledger yet, or an unreadable one: start clean
  }

  const persist = async () => {
    await writeFile(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  };

  return {
    name,
    limit,
    get spent() {
      return state.spent;
    },
    get remaining() {
      return Math.max(0, limit - state.spent);
    },

    /** Whether `n` more requests are allowed today. */
    canSpend(n = 1) {
      return state.spent + n <= limit;
    },

    /**
     * Record requests that have been made. Call this for every ATTEMPT,
     * including failures — a request that errors is still billed.
     */
    async record(n = 1, note = '') {
      state.spent += n;
      await persist();
      await appendFile(
        log,
        `${new Date().toISOString()}\t${n}\t${state.spent}/${limit}\t${note}\n`,
        'utf8',
      );
    },

    report() {
      return `${state.spent} of ${limit} requests used today (${this.remaining} left)`;
    },
  };
}

/**
 * The banner every spending collector prints before it does anything.
 *
 * Says plainly which mode it is in, so a dry run can never be mistaken for a
 * real one in a scrollback.
 */
export function announce({ live, limit }, planned, budget) {
  if (!live) {
    console.log('DRY RUN — no API calls will be made, nothing will be spent.');
    console.log(`Would make ${planned} requests. Pass --live to actually run it.\n`);
    return;
  }
  console.log('LIVE — this will call the API and incur cost.');
  console.log(`Planned requests: ${planned}`);
  console.log(`Budget: ${budget.report()}`);
  console.log(`Ceiling for this run: ${limit} (change with --limit N)\n`);
}
