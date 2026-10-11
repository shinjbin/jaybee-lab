from __future__ import annotations

import unittest
from statistics import fmean, pstdev

from models import Candle, Position, Signal
from strategy import BollingerBreakoutStrategy

DAY = 86_400_000


def candles(closes, opens=None):
    opens = opens or closes
    return [Candle(i * DAY, op, max(op, close), min(op, close), close, 1, (i + 1) * DAY - 1)
            for i, (op, close) in enumerate(zip(opens, closes))]


class StrategyTests(unittest.TestCase):
    def setUp(self):
        self.strategy = BollingerBreakoutStrategy(49, 1.8)

    def test_first_breakout_including_previous_equality(self):
        result = self.strategy.evaluate(candles([100] * 49 + [150]), Position.CASH)
        self.assertEqual(result.signal, Signal.BUY)
        self.assertEqual(result.previous_close, result.previous_upper)
        self.assertAlmostEqual(result.sma, fmean([100] * 48 + [150]))
        self.assertAlmostEqual(result.std, pstdev([100] * 48 + [150]))
        self.assertAlmostEqual(result.upper, result.sma + 1.8 * result.std)

    def test_sustained_above_upper_does_not_buy_again(self):
        result = self.strategy.evaluate(candles([100] * 49 + [150, 160]), Position.CASH)
        self.assertGreater(result.previous_close, result.previous_upper)
        self.assertGreater(result.candle.close, result.upper)
        self.assertEqual(result.signal, Signal.HOLD)

    def test_long_cannot_add_even_on_new_breakout(self):
        self.assertEqual(self.strategy.evaluate(candles([100] * 49 + [150]), Position.LONG).signal, Signal.HOLD)

    def test_only_long_exits_below_middle(self):
        data = candles([100] * 49 + [99])
        self.assertEqual(self.strategy.evaluate(data, Position.LONG).signal, Signal.SELL)
        self.assertEqual(self.strategy.evaluate(data, Position.CASH).signal, Signal.HOLD)

    def test_middle_equality_holds(self):
        self.assertEqual(self.strategy.evaluate(candles([100] * 50), Position.LONG).signal, Signal.HOLD)

    def test_reentering_upper_while_above_middle_does_not_exit(self):
        data = candles([100] * 49 + [150, 105])
        result = self.strategy.evaluate(data, Position.LONG)
        self.assertLess(result.candle.close, result.upper)
        self.assertGreater(result.candle.close, result.sma)
        self.assertEqual(result.signal, Signal.HOLD)

    def test_requires_period_plus_one_and_chronological_data(self):
        with self.assertRaises(ValueError):
            self.strategy.evaluate(candles([100] * 49), Position.CASH)
        with self.assertRaises(ValueError):
            self.strategy.evaluate(list(reversed(candles([100] * 50))), Position.CASH)

    def test_parameters_change_behavior(self):
        data = candles([100] * 5 + [150])
        self.assertEqual(BollingerBreakoutStrategy(5, 1).evaluate(data, Position.CASH).signal, Signal.BUY)
        self.assertEqual(BollingerBreakoutStrategy(5, 3).evaluate(data, Position.CASH).signal, Signal.HOLD)
