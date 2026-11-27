import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, weeklyCandles, movingAverage, weeklyLine, rangeStart } from '../src/indexChartData.mjs';

test('weekly OHLC preserves first open, extremes and final close across year boundary', () => {
  const candles = normalizeCandles([
    { date: '2027-01-04', open: 14, high: 17, low: 13, close: 16 },
    { date: '2026-12-28', open: 10, high: 15, low: 8, close: 12 },
    { date: '2026-12-30', open: 12, high: 16, low: 9, close: 14 },
    { date: '2026-12-31', open: null, high: 16, low: 9, close: 14 },
  ]);
  assert.deepEqual(weeklyCandles(candles), [
    { time: '2026-12-28', open: 10, high: 16, low: 8, close: 14 },
    { time: '2027-01-04', open: 14, high: 17, low: 13, close: 16 },
  ]);
});

test('daily averages and Bollinger bands require a full window and retain warmup', () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), close: i + 1,
  }));
  assert.equal(movingAverage(candles, 60)[0].value, 30.5);
  assert.equal(movingAverage(candles.slice(0, 59), 60).length, 0);
  const points = [{ time: '2026-01-01', close: 1 }, { time: '2026-01-02', close: 3 }];
  assert.equal(movingAverage(points, 2, 2)[0].value, 4);
  assert.equal(movingAverage(points, 2, -2)[0].value, 0);
  const weekly = weeklyLine(movingAverage(candles, 5));
  assert.equal(weekly.at(-1).value, 58);
  assert.equal(new Set(weekly.map((p) => p.time)).size, weekly.length);
});

test('calendar ranges clamp leap day and month end correctly', () => {
  assert.equal(rangeStart([{ time: '2024-02-29' }], 12), '2023-02-28');
  assert.equal(rangeStart([{ time: '2026-03-31' }], 1), '2026-02-28');
  assert.equal(rangeStart([], 12), '');
});


test('ten-year calendar range preserves leap-day rules', () => {
  assert.equal(rangeStart([{ time: '2024-02-29' }], 120), '2014-02-28');
});
