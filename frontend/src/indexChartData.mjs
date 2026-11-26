export function normalizeCandles(history = []) {
  const days = new Map();
  for (const row of history) {
    const values = [row.open, row.high, row.low, row.close];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        values.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) continue;
    const [open, high, low, close] = values.map(Number);
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) continue;
    days.set(row.date, { time: row.date, open, high, low, close });
  }
  return [...days.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function weekStart(time) {
  const date = new Date(`${time}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function weeklyCandles(candles) {
  const weeks = new Map();
  for (const candle of candles) {
    const time = weekStart(candle.time);
    const current = weeks.get(time);
    weeks.set(time, current ? { ...current, high: Math.max(current.high, candle.high),
      low: Math.min(current.low, candle.low), close: candle.close } : { ...candle, time });
  }
  return [...weeks.values()];
}

export function movingAverage(candles, period, deviation = 0) {
  return candles.flatMap((candle, index) => {
    if (index < period - 1) return [];
    const closes = candles.slice(index - period + 1, index + 1).map((row) => row.close);
    const mean = closes.reduce((sum, close) => sum + close, 0) / period;
    const variance = closes.reduce((sum, close) => sum + (close - mean) ** 2, 0) / period;
    return [{ time: candle.time, value: mean + deviation * Math.sqrt(variance) }];
  });
}

export function weeklyLine(points) {
  const weeks = new Map();
  for (const point of points) {
    const time = weekStart(point.time);
    weeks.set(time, { ...point, time });
  }
  return [...weeks.values()];
}

export function rangeStart(candles, months) {
  if (!candles.length) return "";
  const date = new Date(`${candles.at(-1).time}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}
