/**
 * Timezone helpers built on Intl (no extra dependency). The app stores UTC
 * ISO strings and renders/reasons in the student's TZ.
 */

/** Wall-clock parts of `date` in `tz`. */
export function partsInTz(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
  return {
    year: +map.year, month: +map.month, day: +map.day,
    hour: +map.hour, minute: +map.minute, second: +map.second,
    weekday,
  };
}

/** Offset (ms) of `tz` from UTC at the instant `date`. */
function tzOffsetMs(date: Date, tz: string) {
  const p = partsInTz(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Build the UTC instant for a wall-clock time in `tz`. */
export function zonedToUtc(
  year: number, month: number, day: number, hour: number, minute: number, tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = tzOffsetMs(guess, tz);
  const corrected = new Date(guess.getTime() - offset);
  // Second pass handles DST edges. For a wall-clock time that doesn't exist
  // (spring-forward gap) the two candidates differ; take the later one so the
  // result lands after the gap rather than before it.
  const offset2 = tzOffsetMs(corrected, tz);
  if (offset2 === offset) return corrected;
  const alt = new Date(guess.getTime() - offset2);
  const matches = (d: Date) => {
    const p = partsInTz(d, tz);
    return p.hour === hour && p.minute === minute && p.day === day;
  };
  if (matches(alt)) return alt;
  if (matches(corrected)) return corrected;
  return alt.getTime() > corrected.getTime() ? alt : corrected;
}

export function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Next date (>= today in tz) that falls on `dayOfWeek`, at `hm` wall-clock time. */
export function nextOccurrence(dayOfWeek: number, hm: string, tz: string, from = new Date()): Date {
  const today = partsInTz(from, tz);
  let delta = (dayOfWeek - today.weekday + 7) % 7;
  const { h, m } = parseHm(hm);
  if (delta === 0 && (today.hour > h || (today.hour === h && today.minute >= m))) delta = 7;
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day + delta));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m, tz);
}

/**
 * Next occurrence of a weekly `start`-`end` window. `end` is derived from
 * `start` so both always fall on the same day (even when called mid-window).
 */
export function occurrenceRange(dayOfWeek: number, startHm: string, endHm: string, tz: string, from = new Date()) {
  const start = nextOccurrence(dayOfWeek, startHm, tz, from);
  const s = parseHm(startHm), e = parseHm(endHm);
  let minutes = (e.h * 60 + e.m) - (s.h * 60 + s.m);
  if (minutes <= 0) minutes = 60; // malformed range: assume one hour
  return { start, end: new Date(start.getTime() + minutes * 60000) };
}

/** Whole weeks from now until `isoEnd` (min 1, default 12 if unknown). */
export function weeksUntil(isoEnd: string | null | undefined): number {
  if (!isoEnd) return 12;
  const ms = new Date(isoEnd).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / (7 * 24 * 3600 * 1000)));
}

/** Start of the given day (in tz) as a UTC instant. */
export function startOfDayTz(date: Date, tz: string): Date {
  const p = partsInTz(date, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600 * 1000);
}

export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

export const TZ = () => process.env.TZ || "America/New_York";

export function dayName(d: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d] ?? String(d);
}
