/**
 * SPEND GUARD — reserves attempts atomically before a collector calls a paid API.
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
import { mkdir, readFile, writeFile, appendFile, rename, rm, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'data', '.budget');

/**
 * Conservative default. Enough to verify an integration or run a small sample;
 * far below any real collection sweep, which has to be asked for deliberately.
 */
export const DEFAULT_DAILY_LIMIT = 200;

/** All runners use Dhaka's calendar day, including UTC CI hosts. */
function today() {
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Invalid budget name or limit.');
  }
  const currentDay = () => options.date ?? today();
  const file = join(dir, name + '.json');
  const lock = file + '.lock';
  const log = join(dir, name + '.log');
  await mkdir(dir, { recursive: true });
  const readState = async () => {
    const day = currentDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid budget date.');
    let parsed;
    try { parsed = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { date: day, spent: 0 };
      throw new Error('Budget ledger unreadable; refusing to spend.', { cause: error });
    }
    if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        || !Number.isSafeInteger(parsed.spent) || parsed.spent < 0 || parsed.date > day) {
      throw new Error('Invalid budget ledger; refusing to spend.');
    }
    return parsed.date === day ? parsed : { date: day, spent: 0 };
  };
  let state = await readState();
  const validCount = n => Number.isSafeInteger(n) && n > 0;
  return {
    name, limit,
    get spent() { return state.spent; },
    get remaining() { return Math.max(0, limit - state.spent); },
    // Advisory snapshot only. record() is the authoritative reservation.
    canSpend(n = 1) { return validCount(n) && state.spent + n <= limit; },
    /** Reserve BEFORE the paid attempt. Failed attempts are never refunded. */
    async record(n = 1, note = '') {
      if (!validCount(n)) throw new Error('Budget count must be a positive integer.');
      const deadline = Date.now() + 3000;
      for (;;) {
        try { await mkdir(lock); break; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (Date.now() >= deadline) throw new Error('Budget lock unavailable; refusing to spend.');
          await delay(10);
        }
      }
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        state = await readState();
        if (state.spent + n > limit) throw new Error('Budget exhausted; refusing to spend.');
        const next = { date: state.date, spent: state.spent + n };
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', flush: true });
        await rename(temporary, file);
        state = next;
        await appendFile(log, new Date().toISOString() + '\t' + n + '\t' + state.spent + '/' + limit + '\t' + note + '\n');
      } finally {
        await rm(temporary, { force: true });
        await rmdir(lock);
      }
    },
    report() { return state.spent + ' of ' + limit + ' requests used today (' + this.remaining + ' left)'; },
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
