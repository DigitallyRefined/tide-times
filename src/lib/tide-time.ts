const formatterCache = new Map<
  string,
  { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat; timeWithZone: Intl.DateTimeFormat }
>();

function formattersFor(timezone: string) {
  let entry = formatterCache.get(timezone);
  if (!entry) {
    entry = {
      time: new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }),
      date: new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        month: 'short',
        day: '2-digit',
      }),
      timeWithZone: new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    };
    formatterCache.set(timezone, entry);
  }
  return entry;
}

export function formatStationTime(date: Date, timezone: string): string {
  return formattersFor(timezone).time.format(date);
}

export function formatStationDate(date: Date, timezone: string): string {
  return formattersFor(timezone).date.format(date);
}

export function formatStationTimeDate(date: Date, timezone: string): string {
  return `${formattersFor(timezone).date.format(date)} · ${formattersFor(timezone).timeWithZone.format(date)}`;
}

export function formatLevel(level: number, unit: string): string {
  const value = level.toFixed(2);
  if (unit === 'feet') return `${value} ft`;
  return `${value} m`;
}
