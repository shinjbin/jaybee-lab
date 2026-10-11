from __future__ import annotations

import unittest
from dataclasses import replace

from backtest import Backtester
from config import Settings
from models import Signal
from strategy import BollingerBreakoutStrategy
from test_strategy import DAY, candles


class BacktestTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(bollinger_period=5, bollinger_stddev=1, history_limit=20,
                                 initial_cash=1000, fee_rate=0.01, slippage_rate=0.1)
        self.strategy = BollingerBreakoutStrategy(5, 1)

    def test_next_open_and_both_sides_costs(self):
        data = candles([100] * 5 + [200, 300, 50, 80])
        result = Backtester(self.settings, self.strategy).run(data, now_ms=10 * DAY)
        buy, sell = result["trades"]
        self.assertEqual(buy["signal_candle"], 5 * DAY)
        self.assertEqual(buy["execution_time"], 6 * DAY)
        self.assertEqual(float(buy["execution_price"]), 330)
        self.assertEqual(float(sell["execution_price"]), 72)
        quantity = 1000 / (330 * 1.01)
        self.assertAlmostEqual(float(buy["quantity"]), quantity)
        self.assertAlmostEqual(float(buy["fee"]), quantity * 330 * 0.01)
        self.assertAlmostEqual(float(sell["fee"]), quantity * 72 * 0.01)
        self.assertAlmostEqual(result["final_equity"], quantity * 72 * 0.99)
        self.assertEqual(result["position"], "CASH")
        self.assertEqual(result["quantity"], "0")

    def test_final_signal_and_incomplete_next_candle_are_not_filled(self):
        data = candles([100] * 5 + [200, 300])
        result = Backtester(self.settings, self.strategy).run(data, now_ms=6 * DAY)
        self.assertEqual(result["trade_count"], 0)
        self.assertEqual(result["unexecuted_signal"], "BUY")

    def test_future_data_cannot_change_earlier_signals(self):
        prefix = [100] * 5 + [200, 300, 50]
        short = Backtester(self.settings, self.strategy).run(candles(prefix), now_ms=20 * DAY)
        long = Backtester(self.settings, self.strategy).run(candles(prefix + [900, 10, 2000]), now_ms=20 * DAY)
        self.assertEqual(short["decisions"], long["decisions"][:len(short["decisions"])])
        self.assertEqual(short["trades"], long["trades"][:len(short["trades"])])

    def test_validation_range_starts_cash_and_only_warms_with_earlier_data(self):
        data = candles([100] * 5 + [200, 300, 50, 80])
        result = Backtester(self.settings, self.strategy).run(data, start_ms=6 * DAY, end_ms=8 * DAY, now_ms=10 * DAY)
        self.assertEqual(result["trade_count"], 0)
        self.assertEqual(result["final_equity"], 1000)
        self.assertTrue(all(d["candle"] >= 6 * DAY for d in result["decisions"]))

    def test_fractional_position_still_exits_all(self):
        settings = replace(self.settings, position_size=0.5)
        result = Backtester(settings, self.strategy).run(candles([100] * 5 + [200, 300, 50, 80]), now_ms=10 * DAY)
        self.assertEqual(result["quantity"], "0")
        self.assertAlmostEqual(result["final_equity"], 500 + (500 / (330 * 1.01)) * 72 * 0.99)

    def test_shared_signal_matches_standalone_strategy(self):
        data = candles([100] * 5 + [200])
        result = Backtester(self.settings, self.strategy).run(data, now_ms=10 * DAY)
        self.assertEqual(result["decisions"][-1]["signal"], self.strategy.evaluate(data, "CASH").signal.value)

    def test_gap_and_unsorted_data_are_rejected(self):
        data = candles([100] * 10)
        with self.assertRaises(ValueError):
            Backtester(self.settings, self.strategy).run(data[:5] + data[6:], now_ms=20 * DAY)
        with self.assertRaises(ValueError):
            Backtester(self.settings, self.strategy).run(list(reversed(data)), now_ms=20 * DAY)
