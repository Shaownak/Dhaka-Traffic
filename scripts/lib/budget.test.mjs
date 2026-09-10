/**
 * Tests for the spend guard.
 *
 * This is the only thing standing between a defect in a collection loop and a
 * bill on a shared organisational account. A ceiling nobody has watched hold is
 * not a ceiling, so it gets tested like the rest of the system.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DAILY_LIMIT, openBudget, parseMode } from './budget.mjs';

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'budget-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('run mode', () => {
  it('defaults to a dry run when no flags are given', () => {
    const mode = parseMode(['node', 'collect.mjs']);
    expect(mode.live).toBe(false);
    expect(mode.dryRun).toBe(true);
  });

  it('only goes live when explicitly asked', () => {
    expect(parseMode(['node', 'x', '--live']).live).toBe(true);
  });

  it('does not treat --dry-run as permission to spend', () => {
    // the old flag: harmless now, and must not flip the default
    expect(parseMode(['node', 'x', '--dry-run']).live).toBe(false);
  });

  it('reads a limit, and falls back to the conservative default', () => {
    expect(parseMode(['node', 'x', '--limit', '25']).limit).toBe(25);
    expect(parseMode(['node', 'x']).limit).toBe(DEFAULT_DAILY_LIMIT);
  });

  it('ignores a nonsense limit rather than spending on it', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      expect(parseMode(['node', 'x', '--limit', bad]).limit).toBe(DEFAULT_DAILY_LIMIT);
    }
  });
});

describe('the ceiling', () => {
  it('starts empty', async () => {
    const b = await openBudget('t', 10, { dir });
    expect(b.spent).toBe(0);
    expect(b.remaining).toBe(10);
    expect(b.canSpend(1)).toBe(true);
  });

  it('refuses the request that would cross the limit', async () => {
    const b = await openBudget('t', 3, { dir });
    for (let i = 0; i < 3; i++) {
      expect(b.canSpend(1)).toBe(true);
      await b.record(1);
    }
    expect(b.spent).toBe(3);
    expect(b.remaining).toBe(0);
    expect(b.canSpend(1)).toBe(false);
  });

  it('refuses a batch that would overshoot, not just a single', async () => {
    const b = await openBudget('t', 10, { dir });
    await b.record(8);
    expect(b.canSpend(1)).toBe(true);
    expect(b.canSpend(2)).toBe(true);
    expect(b.canSpend(3)).toBe(false);
  });

  it('refuses reservations even when the caller ignores canSpend', async () => {
    const b = await openBudget('t', 5, { dir });
    await expect(b.record(99)).rejects.toThrow(/exhausted/i);
    expect(b.spent).toBe(0);
    expect(b.remaining).toBe(5);
  });
});

describe('the ledger survives the process', () => {
  it('carries the count into a separate run on the same day', async () => {
    const first = await openBudget('t', 10, { dir, date: '2026-09-10' });
    await first.record(4);

    // a cron firing again is a brand new process reading the same ledger
    const second = await openBudget('t', 10, { dir, date: '2026-09-10' });
    expect(second.spent).toBe(4);
    expect(second.remaining).toBe(6);
  });

  it('resets on a new day', async () => {
    const monday = await openBudget('t', 10, { dir, date: '2026-09-10' });
    await monday.record(10);
    expect(monday.canSpend(1)).toBe(false);

    const tuesday = await openBudget('t', 10, { dir, date: '2026-09-11' });
    expect(tuesday.spent).toBe(0);
    expect(tuesday.canSpend(1)).toBe(true);
  });

  it('keeps separate collectors on separate budgets', async () => {
    const a = await openBudget('alpha', 10, { dir, date: '2026-09-10' });
    await a.record(10);
    const b = await openBudget('beta', 10, { dir, date: '2026-09-10' });
    expect(b.spent).toBe(0);
  });

  it('fails closed on a corrupt ledger', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 't.json'), 'not json at all', 'utf8');
    await expect(openBudget('t', 10, { dir })).rejects.toThrow(/unreadable/i);
  });
});

describe('the audit trail', () => {
  it('writes one line per recorded spend', async () => {
    const b = await openBudget('t', 10, { dir, date: '2026-09-10' });
    await b.record(1, 'gulshan|badda');
    await b.record(1, 'banani|kuril');

    const log = await readFile(join(dir, 't.log'), 'utf8');
    const lines = log.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('gulshan|badda');
    expect(lines[1]).toContain('2/10');
  });

  it('persists after every single record, not at exit', async () => {
    // a crash mid-sweep must not lose the count, or the next run overspends
    const b = await openBudget('t', 10, { dir, date: '2026-09-10' });
    await b.record(1);
    const onDisk = JSON.parse(await readFile(join(dir, 't.json'), 'utf8'));
    expect(onDisk.spent).toBe(1);
  });
});


describe('atomic reservations', () => {
  it('only one concurrent instance may reserve the last attempt', async () => {
    const budgets = await Promise.all(Array.from({ length: 8 }, () => openBudget('shared', 1, { dir })));
    const outcomes = await Promise.allSettled(budgets.map(b => b.record(1)));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, 'shared.json'), 'utf8')).spent).toBe(1);
  });

  it('coordinates independent Node processes through the same ledger', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const source = new URL('./budget.mjs', import.meta.url).href;
    const code = 'import { openBudget } from ' + JSON.stringify(source) + '; const b = await openBudget("processes", 2, { dir: ' + JSON.stringify(dir) + ' }); try { await b.record(); console.log("reserved"); } catch { console.log("refused"); }';
    const results = await Promise.all(Array.from({ length: 6 }, () => run(process.execPath, ['--input-type=module', '-e', code])));
    expect(results.filter(r => r.stdout.trim() === 'reserved')).toHaveLength(2);
    expect(JSON.parse(await readFile(join(dir, 'processes.json'), 'utf8')).spent).toBe(2);
  });

  it('does not permit negative counts or altered ledgers to reset spending', async () => {
    const b = await openBudget('t', 2, { dir });
    await expect(b.record(-1)).rejects.toThrow();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 't.json'), '{"date":"2026-09-10","spent":-4}');
    await expect(b.record()).rejects.toThrow(/ledger/i);
  });
});
