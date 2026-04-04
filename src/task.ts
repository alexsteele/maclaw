import type { TaskSchedule, Weekday } from "./types.js";

const weekdayOrder: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Examples:
// "9:00 AM"
// "17:30"
const parseTimeOfDay = (value: string): { hour: number; minute: number } | null => {
  const trimmed = value.trim();
  const twelveHourMatch = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/u.exec(trimmed);
  if (twelveHourMatch) {
    const rawHour = Number.parseInt(twelveHourMatch[1] ?? "", 10);
    const minute = Number.parseInt(twelveHourMatch[2] ?? "", 10);
    const meridiem = (twelveHourMatch[3] ?? "").toUpperCase();

    if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    let hour = rawHour % 12;
    if (meridiem === "PM") {
      hour += 12;
    }

    return { hour, minute };
  }

  const twentyFourHourMatch = /^(\d{1,2}):(\d{2})$/u.exec(trimmed);
  if (!twentyFourHourMatch) {
    return null;
  }

  const hour = Number.parseInt(twentyFourHourMatch[1] ?? "", 10);
  const minute = Number.parseInt(twentyFourHourMatch[2] ?? "", 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
};

// Example:
// "4/5/2026 9:00 AM"
const parseUsDateTime = (value: string): string | null => {
  const trimmed = value.trim();
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/u.exec(trimmed);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  const year = Number.parseInt(match[3] ?? "", 10);
  const rawHour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const meridiem = (match[6] ?? "").toUpperCase();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    rawHour < 1 ||
    rawHour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let hour = rawHour % 12;
  if (meridiem === "PM") {
    hour += 12;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
};

// Examples:
// "mon"
// "mon,wed,fri"
const parseWeekdays = (value: string): Weekday[] | null => {
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  const unique = new Set<Weekday>();
  for (const part of parts) {
    if (!weekdayOrder.includes(part as Weekday)) {
      return null;
    }
    unique.add(part as Weekday);
  }

  return weekdayOrder.filter((day) => unique.has(day));
};

// Examples:
// "once 4/5/2026 9:00 AM | Stock Updates | Send me a monday market update"
// "daily 9:00 AM | Daily Summary | Give me a summary"
// "weekly mon,wed,fri 5:30 PM | Workout | Remind me to work out"
export const parseTaskSchedule = (
  value: string,
): { prompt: string; schedule: TaskSchedule; title: string } | null => {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length !== 3) {
    return null;
  }

  const [schedulePart, title, prompt] = parts;
  if (!schedulePart || !title || !prompt) {
    return null;
  }

  const usDateTime = parseUsDateTime(schedulePart);
  if (usDateTime) {
    return {
      schedule: {
        type: "once",
        runAt: usDateTime,
      },
      title,
      prompt,
    };
  }

  const tokens = schedulePart.split(/\s+/u);
  const kind = tokens[0]?.toLowerCase();

  if (kind === "once" && tokens.length >= 2) {
    const runAt = parseUsDateTime(tokens.slice(1).join(" "));
    if (!runAt) {
      return null;
    }

    return {
      schedule: {
        type: "once",
        runAt,
      },
      title,
      prompt,
    };
  }

  if (kind === "hourly" && tokens.length === 1) {
    return {
      schedule: {
        type: "hourly",
        minute: new Date().getMinutes(),
      },
      title,
      prompt,
    };
  }

  if (kind === "daily" && tokens.length >= 2) {
    const time = parseTimeOfDay(tokens.slice(1).join(" "));
    if (!time) {
      return null;
    }

    return {
      schedule: {
        type: "daily",
        hour: time.hour,
        minute: time.minute,
      },
      title,
      prompt,
    };
  }

  if (kind === "weekly" && tokens.length >= 3) {
    const days = parseWeekdays(tokens[1] ?? "");
    const time = parseTimeOfDay(tokens.slice(2).join(" "));
    if (!days || !time) {
      return null;
    }

    return {
      schedule: {
        type: "weekly",
        days,
        hour: time.hour,
        minute: time.minute,
      },
      title,
      prompt,
    };
  }

  return null;
};
