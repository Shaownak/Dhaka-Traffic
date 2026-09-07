#!/usr/bin/env node
/**
 * Sampling economics for the collection program.
 *
 *   node scripts/sampling-plan.mjs
 *
 * Answers the question the whole program depends on: how long until there are
 * enough observations per cell to fit a distribution, and what does that cost?
 *
 * A "cell" is one link at one hour on one day type. Quantile regression needs
 * enough samples per cell to estimate a tail, not just a mean — the usual rule
 * of thumb is 30 minimum and 50 comfortable for a p10/p90.
 */

const LINKS = 39;
const HOURS = 24;
const WORKING_DAYS_PER_WEEK = 5;
const WEEKEND_DAYS_PER_WEEK = 2;

/** Samples needed in a cell before its distribution is worth publishing. */
const TARGET_MIN = 30;
const TARGET_COMFORTABLE = 50;

/**
 * Variance is not spread evenly across the day, so neither should the budget
 * be. Overnight traffic is quiet AND consistent, which is the cheapest kind of
 * hour to know about; the peaks are where the money should go.
 */
const CADENCE = [
  { name: 'overnight', hours: [0, 1, 2, 3, 4, 5], perHour: 1 / 3 },
  { name: 'shoulder', hours: [6, 11, 12, 13, 14, 15, 22, 23], perHour: 1 },
  { name: 'morning peak', hours: [7, 8, 9, 10], perHour: 4 },
  { name: 'evening peak', hours: [16, 17, 18, 19, 20, 21], perHour: 4 },
];

const fmt = (n) => n.toLocaleString('en-US');

console.log('COLLECTION PROGRAM — sampling economics\n');
console.log(`${LINKS} links, ${HOURS} hours, 2 day types = ${fmt(LINKS * HOURS * 2)} cells\n`);

/* ---------- flat sampling, for comparison ---------- */
console.log('A. Flat: one sample per link per hour');
const flatPerDay = LINKS * HOURS;
console.log(`   ${fmt(flatPerDay)} requests/day, ${fmt(flatPerDay * 30)}/month`);
console.log(`   working cells gain ${WORKING_DAYS_PER_WEEK}/week, weekend cells ${WEEKEND_DAYS_PER_WEEK}/week`);
console.log(`   time to ${TARGET_MIN} samples: working ${Math.ceil(TARGET_MIN / WORKING_DAYS_PER_WEEK)} weeks, `
  + `weekend ${Math.ceil(TARGET_MIN / WEEKEND_DAYS_PER_WEEK)} weeks`);
console.log(`   time to ${TARGET_COMFORTABLE}: working ${Math.ceil(TARGET_COMFORTABLE / WORKING_DAYS_PER_WEEK)} weeks, `
  + `weekend ${Math.ceil(TARGET_COMFORTABLE / WEEKEND_DAYS_PER_WEEK)} weeks\n`);

/* ---------- variance-proportional sampling ---------- */
console.log('B. Variance-proportional: dense at peaks, sparse overnight');
let perDay = 0;
for (const band of CADENCE) {
  const requests = LINKS * band.hours.length * band.perHour;
  perDay += requests;
  const weeklyWorking = band.perHour * WORKING_DAYS_PER_WEEK;
  const weeksToTarget = Math.ceil(TARGET_COMFORTABLE / weeklyWorking);
  console.log(
    `   ${band.name.padEnd(13)} ${String(band.hours.length).padStart(2)} hours  `
    + `${String(band.perHour).padStart(4)}/hour  ${String(Math.round(requests)).padStart(5)} req/day  `
    + `-> ${TARGET_COMFORTABLE} samples in ${weeksToTarget} weeks`,
  );
}
console.log(`   TOTAL ${fmt(Math.round(perDay))} requests/day, ${fmt(Math.round(perDay * 30))}/month\n`);

/* ---------- what it buys ---------- */
const peakBand = CADENCE.find((b) => b.name === 'evening peak');
const peakWeeks = Math.ceil(TARGET_COMFORTABLE / (peakBand.perHour * WORKING_DAYS_PER_WEEK));
const peakWeekend = Math.ceil(TARGET_COMFORTABLE / (peakBand.perHour * WEEKEND_DAYS_PER_WEEK));

console.log('C. Milestones on plan B');
console.log(`   week 1   hourly shape known for every link, both day types`);
console.log(`   week ${String(peakWeeks).padStart(2)}   peak-hour distributions publishable (working days)`);
console.log(`   week ${String(peakWeekend).padStart(2)}   peak-hour distributions publishable (weekends)`);
console.log(`   week 26  a full season, including monsoon, for the first time\n`);

console.log('D. Cost shape');
console.log(`   plan A is ${(flatPerDay / perDay).toFixed(2)}x the requests of plan B`);
console.log(`   and reaches ${TARGET_COMFORTABLE} peak samples ${Math.ceil(TARGET_COMFORTABLE / WORKING_DAYS_PER_WEEK)} weeks in,`);
console.log(`   against ${peakWeeks} weeks for plan B — slower AND more expensive, because it`);
console.log('   spends most of its budget on quiet hours that barely vary.\n');
console.log('   Multiply requests by your current per-request rate for the traffic-aware SKU.');
console.log('   Verify that rate yourself; it moves.');
