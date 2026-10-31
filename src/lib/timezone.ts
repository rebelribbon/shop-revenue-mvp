import { AppError } from "./errors";

const partsFor = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
};

export function localDateKey(date: Date, timeZone: string) {
  const p = partsFor(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addLocalDays(key: string, days: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new AppError("VALIDATION", "Invalid local date.");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

export function localDateTimeToUtc(input: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!m) throw new AppError("VALIDATION", "Choose a valid appointment date and time.");
  const desired = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
  let guess = new Date(desired);
  for (let i = 0; i < 3; i += 1) {
    const p = partsFor(guess, timeZone);
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess = new Date(guess.getTime() + desired - represented);
  }
  if (Number.isNaN(guess.getTime())) throw new AppError("VALIDATION", "Choose a valid appointment date and time.");
  return guess;
}

export function localMidnightToUtc(key: string, timeZone: string) {
  return localDateTimeToUtc(`${key}T00:00`, timeZone);
}


// Date-only invoice terms are calendar dates, never UTC instants to shift locally.
export function formatDateOnly(key:string) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return key;
 const date=new Date(`${key}T12:00:00Z`);
 return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==key?key:date.toLocaleDateString("en-US",{timeZone:"UTC",year:"numeric",month:"short",day:"numeric"});
}
