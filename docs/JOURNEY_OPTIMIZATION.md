# Journey optimization

How a request becomes a recommendation, and why each step is where it is.

## Routes

`src/core/routing/graph.ts`

A 28-junction, 39-road graph of Dhaka. Two operations:

- `fastestRoute()` — time-dependent Dijkstra.
- `routeOptions()` — **Yen's k-shortest-paths**, then a distinctness filter.

### Why Yen's replaced exhaustive enumeration

The original implementation enumerated every simple path up to nine hops. It
worked on short trips and quietly failed on long ones: the deepest journey in the
network is eight hops, so an *alternative* to it needs nine or ten, and the cap
excluded exactly the journeys where a reader most wants a choice.

`scripts/network-audit.mjs` measured it: **9 of 378 place pairs offered only one
route**. After the change, **2 do** — and both of those are genuinely single
roads (Uttara and Bashundhara are dead-end stubs with one connection each).

Yen's is bounded by *k* rather than by path length, so a cross-city trip gets the
same number of alternatives as a short one, and it stays affordable as the
network grows. Cost: `routeOptions` went from 0.03 ms to ~2.9 ms, well inside the
16 ms frame budget.

### Distinctness

Similarity is measured over **roads used**, not junctions visited. Comparing
junctions was the earlier approach and it was wrong: every route between two
points shares both endpoints and usually most of the spine, so a long trip could
collapse to a single "alternative" when real choices existed. Thresholds relax
over successive passes (0.6 → 0.8 → 0.95), so a corridor with few genuine options
still returns something rather than a list of one.

## Scoring routes

`src/core/optimization/scoring.ts`, weights in `src/data/intelligence.ts`.

Five terms — `eta`, `reliability`, `traffic`, `distance`, `simplicity` — scored
**relative to the candidates being compared**, so 100 means "best of these", not
"good". On an evening when every route is bad, the winner is the best of a bad
set and the congestion figures beside it say so.

### Strict criteria

A profile that promises a superlative must deliver it. `FASTEST` sorts on time
outright and uses the blended score only to break ties; without that, the other
40% of the weighting can outvote the criterion the control is named after, and
the label becomes false. Same for `SHORTEST`. Both are tested across every hour
and both day types.

## Stops

`src/core/optimization/stops.ts`

The naive reading of "a restaurant halfway" is "the restaurant nearest the
midpoint", and it is wrong. The midpoint is a point in space; what the traveller
cares about is what the stop costs them. A place 400 m from the midpoint down a
road that is jammed at six is a worse stop than one a kilometre further along a
corridor that is moving.

So the objective is **journey disruption**:

1. Take the direct route's geometry as a corridor.
2. Filter the 2,301-place dataset to those within 2 km of it, via a grid index.
3. Keep those within 0.30 of the requested position along the route.
4. Snap each to its nearest junction; drop anything more than 2.5 km away.
5. Route origin → junction at the departure hour, and junction → destination
   **at the hour they would actually rejoin the road**, after the drive out and
   the meal.
6. Compute the detour against going straight there.
7. Score, rank, and return with reasons.

Routing is cached per junction, not per place: many restaurants share a junction,
and the routing depends only on the junction. That turns hundreds of path
searches into at most a couple of dozen.

### Weights

`STOP_WEIGHTS` in `src/data/intelligence.ts`:

| Term | Weight | What it measures |
|---|---|---|
| `efficiency` | 0.40 | Total journey time including the stop |
| `detour` | 0.20 | Extra driving against going straight |
| `trafficRisk` | 0.15 | Congestion and spread on both legs |
| `position` | 0.15 | Distance from where they asked |
| `access` | 0.10 | How far the door is from the junction |

**Note what is absent: there is no quality term.** OpenStreetMap carries no
ratings. A quality weight could only be fed by something invented, or by a proxy
like "has a website" — which measures how thoroughly a volunteer mapped the place,
not how good it is. Ranking on journey disruption is honest because we compute it
ourselves and can show the arithmetic.

### Two stated limitations

1. **The graph routes between junctions, not doorways.** Every stop reports
   `accessKm`, the straight-line distance from its junction to its door. It is a
   real remaining cost and it is shown, not folded silently into the total.
2. **Opening hours are usually unknown.** About one place in six states them.
   `isOpenAt()` parses a conservative subset and returns `unknown` for anything
   beyond it — never `open`. Telling somebody a restaurant is open when the
   syntax was too complex to read is worse than admitting the data does not say.

### When nothing qualifies

The search returns an empty list and a reason: `no-dataset`,
`none-in-corridor`, or `none-within-detour`. The planner turns that into a
notice, keeps the direct journey, and substitutes nothing.

## Departure optimization

"I must be there by seven."

`optimizeDeparture()` walks candidate departures back from the deadline, costs
each with the same engine that ranks routes, and returns the one that scores best
among those arriving in time — not simply the last that fits. Ties break toward
leaving later.

Two corrections found by testing this against the UI:

- **The stop has to be paid for in the search.** Costing only the driving
  recommended a departure that arrived on time in theory and 25 minutes late in
  fact, because nobody told the search about the 45-minute meal. The dwell is now
  part of the evaluation.
- **The window has to cover the journey.** A fixed 150-minute window declared an
  hour-long dinner impossible rather than looking further back. It now widens by
  the overhead.

After the plan is assembled, the arrival is **verified against the deadline**
rather than assumed, and the departure card is rewritten to describe the journey
actually chosen — otherwise the page showed two arrival times a couple of minutes
apart for the same trip.

## Labels

Awarded by measuring the final set, not by assuming the ranking implies them:
`FASTEST`, `SHORTEST`, `MOST_RELIABLE`, `LEAST_TRAFFIC`, `BEST_WITH_STOP`, and
`RECOMMENDED` for whichever leads.

When a stop was requested and found, the best journey *with* one leads — a faster
direct route is not a better answer to "where can I eat on the way". But the best
stop-free journey is always kept in the list, because the cost of stopping is the
one comparison the reader needs.

## Explanation

`explainPlan()` is a template over the finished plan. Every clause traces to a
number computed above it. The recommendation is settled before a single word is
written, so the prose can only restate it.

If a language model is added, it slots in exactly here, receives the same
structured result, and is constrained to rephrase. It never chooses.
