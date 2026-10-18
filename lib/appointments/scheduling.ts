export type AvailabilityRule = { weekday: number; startTime: string; endTime: string };
export type TimeOff = { startsAt: Date; endsAt: Date };
export type BookedPeriod = { startsAt: Date; endsAt: Date };
export type AvailableSlot = { startsAt: Date; endsAt: Date };

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute) };
}

function localDateTimeToUtc(year: number, month: number, day: number, time: string, timeZone: string): Date | null {
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    guess += desired - represented;
  }
  const result = new Date(guess);
  const local = zonedParts(result, timeZone);
  return local.year === year && local.month === month && local.day === day && local.hour === hour && local.minute === minute ? result : null;
}

function overlaps(start: Date, end: Date, period: BookedPeriod | TimeOff) {
  return start < period.endsAt && end > period.startsAt;
}

export function generateAvailableSlots(input: {
  rules: AvailabilityRule[];
  timeOff: TimeOff[];
  booked: BookedPeriod[];
  timeZone: string;
  slotMinutes: number;
  bufferMinutes: number;
  now?: Date;
  horizonDays?: number;
  limit?: number;
}): AvailableSlot[] {
  const now = input.now ?? new Date();
  const horizonDays = input.horizonDays ?? 14;
  const limit = input.limit ?? 10;
  const formatter = new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  // Validate the time zone before attempting any slot conversion.
  formatter.format(now);
  const slots: AvailableSlot[] = [];
  const firstLocalDay = zonedParts(now, input.timeZone);
  const firstDayMs = Date.UTC(firstLocalDay.year, firstLocalDay.month - 1, firstLocalDay.day);

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const calendarDate = new Date(firstDayMs + offset * 86_400_000);
    const year = calendarDate.getUTCFullYear();
    const month = calendarDate.getUTCMonth() + 1;
    const day = calendarDate.getUTCDate();
    const weekday = calendarDate.getUTCDay();
    for (const rule of input.rules.filter((item) => item.weekday === weekday)) {
      const [startHour, startMinute] = rule.startTime.split(":").map(Number);
      const [endHour, endMinute] = rule.endTime.split(":").map(Number);
      const dayStart = startHour * 60 + startMinute;
      const dayEnd = endHour * 60 + endMinute;
      const step = input.slotMinutes + input.bufferMinutes;
      for (let minuteOfDay = dayStart; minuteOfDay + input.slotMinutes <= dayEnd; minuteOfDay += step) {
        const start = localDateTimeToUtc(year, month, day, `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`, input.timeZone);
        if (!start || start.getTime() <= now.getTime()) continue;
        const end = new Date(start.getTime() + input.slotMinutes * 60_000);
        if (input.timeOff.some((period) => overlaps(start, end, period))) continue;
        if (input.booked.some((period) => overlaps(start, end, period))) continue;
        slots.push({ startsAt: start, endsAt: end });
      }
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, limit);
}
