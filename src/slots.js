import { localDate, zonedTimeToUtc } from "./util.js";

// The daily publishing slots, as wall-clock times in config.timezone (Asia/Kolkata by default).
// A run starts a few minutes early, gets the carousel ready, then publishes exactly at the slot time.

export const SLOTS = [
  { name: "evening", time: "18:00" },
  { name: "night", time: "23:00" },
];

/** Slot instances for the local date of `now`: { ...slot, date, key, at }. */
export function slotsForDay(now, timeZone, date = localDate(now, timeZone)) {
  return SLOTS.map(slot => ({ ...slot, date, key: `${date}@${slot.time}`, at: zonedTimeToUtc(date, slot.time, timeZone) }));
}

/**
 * What a run at `now` should do with each of today's slots, given the recorded slot states.
 *   run    – due: inside [at - prepareAhead, at + grace] and not finished
 *   missed – past the grace window with nothing published
 *   wait / done – nothing to do now
 */
export function planSlots({ now, timeZone, prepareAheadMinutes, runGraceMinutes, maxAttempts, getState }) {
  return slotsForDay(now, timeZone).map(slot => {
    const state = getState(slot.key);
    const status = state?.status;
    const opensAt = slot.at.getTime() - prepareAheadMinutes * 60000;
    const closesAt = slot.at.getTime() + runGraceMinutes * 60000;
    let action;
    if (["published", "dry_run", "missed", "skipped"].includes(status)) action = "done";
    else if ((state?.attempts || 0) >= maxAttempts) action = "done";
    else if (now.getTime() < opensAt) action = "wait";
    else if (now.getTime() > closesAt) action = "missed";
    else action = "run";
    return { ...slot, action, status: status || "pending" };
  });
}
