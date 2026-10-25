/**
 * When a weekly shortlist is due (ADR 0101, brief D13): once a week, at the operator's day and time in their time zone
 * (settings; Monday 09:00 UTC unless they say otherwise). A week is named by the local date of its slot, so a shortlist
 * posts once per week however often the adapter asks, and a week missed while ghostpen was off is never caught up.
 */
export const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Day = (typeof DAYS)[number];
export interface Slot { day: Day; time: string; timeZone: string }

/** `date`'s local calendar parts in `timeZone`. */
function local(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" }).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: DAYS.indexOf(parts.weekday!.toLowerCase() as Day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The week whose slot has most recently passed at `now`: its key, the slot's local date `YYYY-MM-DD` (last week's
 * before this week's slot). Days are counted on the local calendar, so a change to or from summer time moves nothing.
 */
export function currentWeek(slot: Slot, now: Date): string {
  const [hour, minute] = slot.time.split(":").map(Number) as [number, number];
  const at = hour * 60 + minute;
  const today = local(now, slot.timeZone);
  const back = (today.weekday - DAYS.indexOf(slot.day) + 7) % 7;
  // The slot's local date: `back` days before today's local date (calendar arithmetic in UTC, which has no gaps).
  const date = new Date(Date.UTC(today.y, today.m - 1, today.d - back));
  if (back === 0 && today.minutes < at) date.setUTCDate(date.getUTCDate() - 7);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Whether `text` is a valid slot: a day name, `HH:MM` (24-hour) and a time zone this Node knows. */
export function checkSlot(day: unknown, time: unknown, timeZone: unknown): Slot {
  if (typeof day !== "string" || !DAYS.includes(day.toLowerCase() as Day)) throw new Error(`settings: shortlist.day must be one of ${DAYS.join(", ")}`);
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) throw new Error("settings: shortlist.time must be HH:MM (24-hour)");
  if (typeof timeZone !== "string") throw new Error("settings: shortlist.timeZone must be a time zone name");
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { throw new Error("settings: shortlist.timeZone must be a time zone name"); }
  return { day: day.toLowerCase() as Day, time, timeZone };
}
