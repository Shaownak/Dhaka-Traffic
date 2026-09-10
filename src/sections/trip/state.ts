/* =====================================================================
   PLANNER STATE — what the reader has asked for, and what is on screen

   Two objects rather than loose module variables: `form` is the request being
   built, `view` is what the interface is currently showing. Both are mutated
   in place, so every module reads the same object rather than a stale copy.
   ===================================================================== */
import type { PreferenceId } from '../../data/intelligence';
import type { JourneyPlan, JourneyRequest, StopConstraint } from '../../core/journey/types';
import type { JourneyIntent } from '../../core/nl/schema';
import type { PlaceKind } from '../../core/places/provider';

/* ---------- what the reader has asked for ---------- */

export interface FormState {
  fromId: string;
  toId: string;
  date: Date;
  departMinutes: number;
  preference: PreferenceId;
  deadlineOn: boolean;
  deadlineMinutes: number;
  stopOn: boolean;
  stopKinds: PlaceKind[];
  stopPosition: number;
  stopDwell: number;
  stopCuisine?: string;
  stopRequireOpen?: boolean;
  earliestDeparture?: number;
}

export const form: FormState = {
  fromId: 'gulshan',
  toId: 'mirpur10',
  date: new Date(),
  departMinutes: 17 * 60,
  preference: 'BALANCED',
  deadlineOn: false,
  deadlineMinutes: 19 * 60,
  stopOn: false,
  stopKinds: ['restaurant', 'cafe', 'fast_food'],
  stopPosition: 0.5,
  stopDwell: 45,
};


/** What the interface is showing right now. */
export const view: {
  /** The plan on screen, so a route card can highlight itself. */
  current: JourneyPlan | null;
  /** Which option the reader has selected. */
  selectedId: string | null;
} = { current: null, selectedId: null };

/* ---------- running a plan ---------- */

export function requestFromState(): JourneyRequest {
  const request: JourneyRequest = {
    origin: form.fromId,
    destination: form.toId,
    date: form.date,
    preference: form.preference,
  };
  if (form.deadlineOn) request.arriveBy = form.deadlineMinutes;
  else request.departAt = form.departMinutes;
  if (form.deadlineOn && form.earliestDeparture !== undefined) request.departAt = form.earliestDeparture;

  if (form.stopOn) {
    const stop: StopConstraint = {
      kinds: form.stopKinds,
      position: form.stopPosition,
      dwellMinutes: form.stopDwell,
    };
    if (form.stopCuisine !== undefined) stop.cuisine = form.stopCuisine;
    if (form.stopRequireOpen !== undefined) stop.requireOpen = form.stopRequireOpen;
    request.stop = stop;
  }
  return request;
}


/** Replace the whole request so a sentence cannot inherit a previous constraint. */
export function applyIntent(intent: JourneyIntent): void {
  form.fromId = intent.origin;
  form.toId = intent.destination;
  form.date = new Date(intent.date + 'T12:00:00');
  form.departMinutes = intent.departAt ?? 17 * 60;
  form.deadlineOn = intent.arriveBy !== undefined;
  form.deadlineMinutes = intent.arriveBy ?? 19 * 60;
  form.preference = intent.preference ?? 'BALANCED';
  form.stopOn = Boolean(intent.stop);
  form.stopKinds = [...(intent.stop?.kinds ?? ['restaurant', 'cafe', 'fast_food'])];
  form.stopPosition = intent.stop?.position ?? 0.5;
  form.stopDwell = intent.stop?.dwellMinutes ?? 45;
  delete form.stopCuisine;
  delete form.stopRequireOpen;
  delete form.earliestDeparture;
  if (intent.stop?.cuisine !== undefined) form.stopCuisine = intent.stop.cuisine;
  if (intent.stop?.requireOpen !== undefined) form.stopRequireOpen = intent.stop.requireOpen;
  if (intent.arriveBy !== undefined && intent.departAt !== undefined) form.earliestDeparture = intent.departAt;
}
