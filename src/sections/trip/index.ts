/* =====================================================================
   PLAN A TRIP — the controller

   This file wires the DOM to the planner and nothing else. It reads controls
   into `form`, calls planJourney, and hands the result to `render`.

   The drawing lives in map.ts and results.ts; the formatting in format.ts; the
   request shape in state.ts. Every number on screen arrives inside a
   JourneyPlan the core produced, and the two input modes — the form and the
   sentence box — build the same request and call the same planJourney. That is
   what stops the two modes, and the HTTP API beside them, from quietly
   answering differently.
   ===================================================================== */
import { PLACES } from '../../data/network';
import { PREFERENCES, type PreferenceId } from '../../data/intelligence';
import { planJourney } from '../../core/journey/planner';
import { parseJourneyText } from '../../core/nl/parse';
import { JourneyError, type JourneyPlan, type JourneyRequest } from '../../core/journey/types';
import type { PlaceKind } from '../../core/places/provider';
import { applyIntent, form, requestFromState, view } from './state';
import { render, showError } from './results';

/** Guards against an older plan landing after a newer one. */
let generation = 0;

async function run(request: JourneyRequest): Promise<void> {
  const mine = ++generation;
  try {
    const plan = await planJourney(request);
    // a later request may have been fired while this one was resolving
    if (mine !== generation) return;
    view.selectedId = plan.recommended.id;
    render(plan);
  } catch (error) {
    if (mine !== generation) return;
    if (error instanceof JourneyError) showError(error.message);
    else showError('Something went wrong planning that journey.');
  }
}

function update(): void {
  void run(requestFromState());
}

/* ---------- wiring ---------- */

function fillPlaces(select: HTMLSelectElement, selected: string): void {
  const sorted = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    if (p.id === selected) option.selected = true;
    select.append(option);
  }
}

function minutesFromTime(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h! * 60 + m!;
}

export function initTrip(): void {
  const from = document.getElementById('tripFrom') as HTMLSelectElement | null;
  const to = document.getElementById('tripTo') as HTMLSelectElement | null;
  const date = document.getElementById('tripDate') as HTMLInputElement | null;
  const time = document.getElementById('tripTime') as HTMLInputElement | null;
  const pref = document.getElementById('tripPreference') as HTMLSelectElement | null;
  if (!from || !to || !date || !time) return;

  fillPlaces(from, form.fromId);
  fillPlaces(to, form.toId);

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  date.value = iso;
  date.min = iso;
  // midday, so a timezone offset cannot roll the date into another day
  form.date = new Date(`${iso}T12:00:00`);

  from.addEventListener('change', () => { form.fromId = from.value; update(); });
  to.addEventListener('change', () => { form.toId = to.value; update(); });
  date.addEventListener('change', () => {
    if (!date.value) return;
    form.date = new Date(`${date.value}T12:00:00`);
    update();
  });
  time.addEventListener('change', () => {
    const minutes = minutesFromTime(time.value);
    if (minutes !== null) {
      form.departMinutes = minutes;
      if (form.deadlineOn) form.earliestDeparture = minutes;
    }
    if (minutes === null && form.deadlineOn) delete form.earliestDeparture;
    update();
  });

  document.getElementById('tripSwap')?.addEventListener('click', () => {
    [form.fromId, form.toId] = [form.toId, form.fromId];
    from.value = form.fromId;
    to.value = form.toId;
    update();
  });

  if (pref) {
    for (const p of PREFERENCES) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.label;
      option.title = p.blurb;
      if (p.id === form.preference) option.selected = true;
      pref.append(option);
    }
    pref.addEventListener('change', () => {
      form.preference = pref.value as PreferenceId;
      update();
    });
  }

  const clockValue = (m: number): string => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const syncDeparture = (): void => {
    const label = document.querySelector('label[for="tripTime"]');
    if (label) label.textContent = form.deadlineOn ? 'Leave no earlier than (optional)' : 'Leave at';
    time.value = form.deadlineOn
      ? form.earliestDeparture === undefined ? '' : clockValue(form.earliestDeparture)
      : clockValue(form.departMinutes);
  };

  /* deadline */
  const deadlineOn = document.getElementById('tripDeadlineOn') as HTMLInputElement | null;
  const deadlineTime = document.getElementById('tripDeadlineTime') as HTMLInputElement | null;
  if (deadlineOn && deadlineTime) {
    deadlineOn.addEventListener('change', () => {
      form.deadlineOn = deadlineOn.checked;
      delete form.earliestDeparture;
      syncDeparture();
      deadlineTime.disabled = !form.deadlineOn;
      update();
    });
    deadlineTime.addEventListener('change', () => {
      const minutes = minutesFromTime(deadlineTime.value);
      if (minutes !== null) form.deadlineMinutes = minutes;
      update();
    });
  }

  /* stop */
  const stopOn = document.getElementById('tripStopOn') as HTMLInputElement | null;
  const stopKind = document.getElementById('tripStopKind') as HTMLSelectElement | null;
  const stopWhere = document.getElementById('tripStopWhere') as HTMLSelectElement | null;
  const stopDwell = document.getElementById('tripStopDwell') as HTMLSelectElement | null;
  if (stopOn && stopKind && stopWhere && stopDwell) {
    const setEnabled = (): void => {
      for (const control of [stopKind, stopWhere, stopDwell]) control.disabled = !form.stopOn;
    };
    stopOn.addEventListener('change', () => {
      form.stopOn = stopOn.checked;
      setEnabled();
      update();
    });
    stopKind.addEventListener('change', () => {
      form.stopKinds = stopKind.value.split(',') as PlaceKind[];
      update();
    });
    stopWhere.addEventListener('change', () => {
      form.stopPosition = Number(stopWhere.value);
      update();
    });
    stopDwell.addEventListener('change', () => {
      form.stopDwell = Number(stopDwell.value);
      update();
    });
    setEnabled();
  }

  const cuisine = document.getElementById('tripStopCuisine') as HTMLInputElement | null;
  const requireOpen = document.getElementById('tripStopOpen') as HTMLInputElement | null;
  const syncStopExtras = (): void => {
    if (cuisine) { cuisine.disabled = !form.stopOn; cuisine.value = form.stopCuisine ?? ''; }
    if (requireOpen) { requireOpen.disabled = !form.stopOn; requireOpen.checked = form.stopRequireOpen ?? true; }
  };
  cuisine?.addEventListener('change', () => {
    if (cuisine.value.trim()) form.stopCuisine = cuisine.value.trim();
    else delete form.stopCuisine;
    update();
  });
  requireOpen?.addEventListener('change', () => { form.stopRequireOpen = requireOpen.checked; update(); });
  stopOn?.addEventListener('change', syncStopExtras);
  syncStopExtras();

  /* the two modes */
  const modeForm = document.getElementById('tripModeForm');
  const modeText = document.getElementById('tripModeText');
  const panelForm = document.getElementById('tripFormPanel');
  const panelText = document.getElementById('tripTextPanel');

  const showMode = (which: 'form' | 'text'): void => {
    if (!modeForm || !modeText || !panelForm || !panelText) return;
    const isText = which === 'text';
    panelForm.hidden = isText;
    panelText.hidden = !isText;
    modeForm.classList.toggle('is-on', !isText);
    modeText.classList.toggle('is-on', isText);
    modeForm.setAttribute('aria-selected', String(!isText));
    modeText.setAttribute('aria-selected', String(isText));
  };
  modeForm?.addEventListener('click', () => showMode('form'));
  modeText?.addEventListener('click', () => showMode('text'));

  /* the sentence box */
  const text = document.getElementById('tripText') as HTMLInputElement | null;
  const go = document.getElementById('tripTextGo');
  const read = document.getElementById('tripRead');

  const runText = (): void => {
    if (!text) return;
    const parsed = parseJourneyText(text.value, new Date());

    if (read) {
      read.textContent = parsed.ok
        ? `Read as: ${parsed.understood.join(', ')}.`
          + (parsed.problems.length ? ` ${parsed.problems.join(' ')}` : '')
        : parsed.problems.join(' ');
      read.className = `pf-read${parsed.ok ? '' : ' pf-read-bad'}`;
    }
    if (!parsed.ok || !parsed.request) {
      generation++;
      showError(parsed.problems.join(' '));
      return;
    }

    // Mirror the sentence back into the form, so the two modes stay one form.
    const intent = parsed.request;
    applyIntent(intent);
    syncStopExtras();

    from.value = form.fromId;
    to.value = form.toId;
    date.value = intent.date;
    syncDeparture();
    if (pref) pref.value = form.preference;
    const syncSelect = (select: HTMLSelectElement | null, value: string): void => {
      if (!select) return;
      if (![...select.options].some(o => o.value === value)) select.add(new Option(value, value));
      select.value = value;
    };
    syncSelect(stopKind, form.stopKinds.join(','));
    syncSelect(stopWhere, String(form.stopPosition));
    syncSelect(stopDwell, String(form.stopDwell));
    if (deadlineOn && deadlineTime) {
      deadlineOn.checked = form.deadlineOn;
      deadlineTime.value = clockValue(form.deadlineMinutes);
      deadlineTime.disabled = !form.deadlineOn;
    }
    if (stopOn) stopOn.checked = form.stopOn;
    for (const control of [stopKind, stopWhere, stopDwell]) {
      if (control) control.disabled = !form.stopOn;
    }

    update();
  };

  go?.addEventListener('click', runText);
  text?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runText();
    }
  });

  update();
}

/** Exposed for the sources section, which reports what the planner rests on. */
export function currentPlan(): JourneyPlan | null {
  return view.current;
}
