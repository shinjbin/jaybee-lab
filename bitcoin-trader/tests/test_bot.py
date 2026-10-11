from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace

from binance_client import BinanceError
from config import Settings
from models import BotState, Position, Signal
from order_executor import BinanceOrderExecutor, D, SimulatedOrderExecutor
from state_repository import BotBusy, StateRepository
from strategy import BollingerBreakoutStrategy
from trading_bot import PendingOrderUncertain, TradingBot
from test_strategy import DAY, candles


class FakeMarket:
    def __init__(self):
        self.data = candles([100] * 5 + [200])

    def server_time(self):
        return self.data[-1].close_time + 1

    def closed_candles(self, now):
        return self.data

    def execution_price(self):
        return 210


class FakeClient:
    def __init__(self, settings):
        self.settings = settings
        self.btc, self.usdt = "0", "10000"
        self.posts = []
        self.order = None
        self.submit_error = None
        self.query_error = None
        self.open = []
        self.status = "FILLED"
        self.account_error = False
        self.fill_qty = "1"

    def symbol_info(self):
        return {"baseAsset": "BTC", "quoteAsset": "USDT", "quoteAssetPrecision": 8,
                "filters": [{"filterType": "LOT_SIZE", "minQty": "0.00001", "maxQty": "1000", "stepSize": "0.00001"},
                            {"filterType": "MARKET_LOT_SIZE", "minQty": "0", "maxQty": "100", "stepSize": "0"},
                            {"filterType": "MIN_NOTIONAL", "minNotional": "5", "applyToMarket": True}]}

    def account(self):
        if self.account_error:
            raise BinanceError(uncertain=True)
        return {"canTrade": True, "balances": [{"asset": "BTC", "free": self.btc, "locked": "0"},
                {"asset": "USDT", "free": self.usdt, "locked": "0"}]}

    def open_orders(self):
        return self.open

    def submit_order(self, params):
        self.posts.append(params)
        self.order = {"orderId": 123, "clientOrderId": params["newClientOrderId"], "symbol": "BTCUSDT",
                      "side": params["side"], "status": self.status, "executedQty": self.fill_qty,
                      "cummulativeQuoteQty": str(D(self.fill_qty) * 200), "transactTime": 6 * DAY,
                      "fills": [{"qty": self.fill_qty, "commission": "0.001", "commissionAsset": "BTC"}]}
        if self.submit_error:
            if self.submit_error.uncertain:
                self.btc, self.usdt = "0.999", "9800"
            raise self.submit_error
        if params["side"] == "BUY":
            self.btc, self.usdt = str(D(self.fill_qty) - D("0.001")), "9800"
        else:
            self.btc, self.usdt = str(D(self.btc) - D(self.fill_qty)), "10200"
        return dict(self.order)

    def query_order(self, client_id):
        if self.query_error:
            raise self.query_error
        return dict(self.order)

    def order_trades(self, order_id):
        return self.order["fills"]


class BotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings(bollinger_period=5, bollinger_stddev=1, history_limit=20)
        self.market = FakeMarket()
        self.strategy = BollingerBreakoutStrategy(5, 1)

    def tearDown(self):
        self.tmp.cleanup()

    def make_bot(self, live=False):
        settings = replace(self.settings, state_path=self.tmp.name + "/state.sqlite3", dry_run=not live,
                           api_key="test-key", api_secret="test-secret")
        repository = StateRepository(settings.state_path, "live" if live else "dry", BotState(cash=D(10000)))
        self.client = FakeClient(settings)
        executor = BinanceOrderExecutor(self.client) if live else SimulatedOrderExecutor(settings)
        return TradingBot(settings, self.market, self.strategy, executor, repository)

    def test_dry_run_persists_and_repeated_candle_does_not_order(self):
        bot = self.make_bot()
        result = bot.run_once()
        self.assertEqual(result["side"], "BUY")
        self.assertEqual(bot.repository.load().position, Position.LONG)
        restarted = self.make_bot()
        self.assertIsNone(restarted.run_once())
        self.assertEqual(len(restarted.repository.records("trades")), 1)
        log = restarted.repository.records("decisions")[0]
        self.assertEqual(log["virtual_order_price"], "210.1050")
        self.assertIsNotNone(log["order_quantity"])
        self.assertEqual(self.client.posts, [])

    def test_hold_is_logged_and_processed_once(self):
        self.market.data = candles([100] * 6)
        bot = self.make_bot()
        self.assertEqual(bot.run_once()["signal"], "HOLD")
        self.assertIsNone(bot.run_once())
        self.assertEqual(len(bot.repository.records("decisions")), 1)

    def test_confirmed_live_fill_and_commission_use_actual_account(self):
        bot = self.make_bot(live=True)
        result = bot.run_once()
        state = bot.repository.load()
        self.assertEqual(state.position, Position.LONG)
        self.assertEqual(state.quantity, D("0.999"))
        self.assertEqual(state.last_entry_price, D(200))
        self.assertEqual(state.last_order_id, "123")
        self.assertEqual(result["fee"], {"BTC": "0.001"})
        self.assertIsNone(bot.run_once())
        self.assertEqual(len(self.client.posts), 1)
        self.assertIn("quoteOrderQty", self.client.posts[0])

    def test_timeout_then_restart_queries_without_resubmission(self):
        bot = self.make_bot(live=True)
        self.client.submit_error = BinanceError(code=-1007, status=504, uncertain=True)
        with self.assertRaises(PendingOrderUncertain):
            bot.run_once()
        state = bot.repository.load()
        self.assertEqual(state.position, Position.CASH)
        self.assertIsNone(state.last_processed_open_time)
        self.assertTrue(state.pending_order["attempted"])
        restarted = TradingBot(bot.settings, self.market, self.strategy, bot.executor,
            StateRepository(bot.settings.state_path, "live", BotState()))
        self.assertEqual(restarted.run_once()["side"], "BUY")
        self.assertEqual(len(self.client.posts), 1)
        self.assertIsNone(bot.repository.load().pending_order)
        self.assertEqual(len(bot.repository.records("trades")), 1)

    def test_unknown_missing_order_never_resubmits(self):
        bot = self.make_bot(live=True)
        self.client.submit_error = BinanceError(uncertain=True)
        with self.assertRaises(PendingOrderUncertain):
            bot.run_once()
        self.client.query_error = BinanceError(code=-2013, status=400)
        for _ in range(3):
            with self.assertRaises(PendingOrderUncertain):
                bot.run_once()
        self.assertEqual(len(self.client.posts), 1)
        self.assertIsNotNone(bot.repository.load().pending_order)

    def test_definite_rejection_does_not_change_position_or_retry_candle(self):
        bot = self.make_bot(live=True)
        self.client.submit_error = BinanceError(code=-2010, status=400)
        bot.run_once()
        state = bot.repository.load()
        self.assertEqual(state.position, Position.CASH)
        self.assertIsNone(state.last_order_id)
        self.assertIsNone(state.pending_order)
        self.assertEqual(state.last_processed_open_time, 5 * DAY)
        self.assertIsNone(bot.run_once())
        self.assertEqual(len(self.client.posts), 1)

    def test_partial_fill_blocks_new_orders_until_terminal_and_keeps_long(self):
        bot = self.make_bot(live=True)
        self.client.status, self.client.fill_qty = "PARTIALLY_FILLED", "0.4"
        bot.run_once()
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertIsNotNone(bot.repository.load().pending_order)
        self.assertEqual(bot.repository.records("trades"), [])
        self.client.order["status"] = "EXPIRED"
        result = bot.run_once()
        self.assertEqual(result["quantity"], "0.4")
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertEqual(len(self.client.posts), 1)

    def test_existing_btc_blocks_buy_after_fresh_start(self):
        bot = self.make_bot(live=True)
        self.client.btc = "1"
        self.assertEqual(bot.run_once()["signal"], "HOLD")
        self.assertEqual(self.client.posts, [])

    def test_sell_all_rounds_down_and_accounts_for_unsellable_dust(self):
        self.market.data = candles([100] * 5 + [50])
        bot = self.make_bot(live=True)
        self.client.btc = "1.000009"
        bot.run_once()
        self.assertEqual(self.client.posts[0]["quantity"], "1.00000")
        self.assertEqual(bot.repository.load().position, Position.CASH)
        self.assertEqual(bot.repository.load().quantity, D("0.000009"))

    def test_open_order_and_insufficient_quote_do_not_submit(self):
        for open_orders, cash in [([{"orderId": 1}], "10000"), ([], "1")]:
            with self.subTest(open_orders=open_orders, cash=cash):
                # Separate persistent state for each case.
                self.settings = replace(self.settings, symbol="BTCUSDT")
                bot = self.make_bot(live=True)
                with bot.repository.lock():
                    bot.repository.save(BotState(cash=D(10000)))
                self.client.open, self.client.usdt = open_orders, cash
                bot.run_once()
                self.assertEqual(self.client.posts, [])
                self.assertEqual(bot.repository.load().position, Position.CASH)

    def test_lock_and_identity_guard_concurrent_or_mixed_mode_execution(self):
        bot = self.make_bot()
        with bot.repository.lock():
            with self.assertRaises(BotBusy):
                bot.run_once()
        with self.assertRaises(ValueError):
            StateRepository(bot.settings.state_path, "live", BotState())

    def test_crash_before_send_in_live_mode_does_not_blindly_retry(self):
        bot = self.make_bot(live=True)
        original_submit = bot.executor.submit
        def crash(intent):
            raise RuntimeError("process crash before network call")
        bot.executor.submit = crash
        with self.assertRaises(RuntimeError):
            bot.run_once()
        bot.executor.submit = original_submit
        self.client.query_error = BinanceError(code=-2013, status=400)
        with self.assertRaises(PendingOrderUncertain):
            bot.run_once()
        self.assertEqual(self.client.posts, [])

    def test_dry_run_recovers_pending_virtual_fill_without_duplicate(self):
        bot = self.make_bot()
        original_fill = bot.executor.fill
        bot.executor.fill = lambda *_: (_ for _ in ()).throw(RuntimeError("crash"))
        with self.assertRaises(RuntimeError):
            bot.run_once()
        bot.executor.fill = original_fill
        bot.run_once()
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertEqual(len(bot.repository.records("trades")), 1)

    def test_fill_history_lag_keeps_pending_and_recovers_without_new_order(self):
        bot = self.make_bot(live=True)
        original_submit = bot.executor.submit
        def submit_without_fills(intent):
            response = original_submit(intent)
            response.pop("fills")
            return response
        bot.executor.submit = submit_without_fills
        original_trades = self.client.order_trades
        self.client.order_trades = lambda _: []
        with self.assertRaises(ValueError):
            bot.run_once()
        self.assertEqual(bot.repository.load().position, Position.CASH)
        self.assertIsNotNone(bot.repository.load().pending_order)
        self.client.order_trades = original_trades
        bot.run_once()
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertEqual(len(self.client.posts), 1)

    def test_account_failure_after_fill_recovers_durable_receipt(self):
        bot = self.make_bot(live=True)
        original_submit = bot.executor.submit
        def submit_then_account_failure(intent):
            response = original_submit(intent)
            self.client.account_error = True
            return response
        bot.executor.submit = submit_then_account_failure
        with self.assertRaises(BinanceError):
            bot.run_once()
        state = bot.repository.load()
        self.assertEqual(state.position, Position.CASH)
        self.assertEqual(state.pending_order["response"]["orderId"], 123)
        self.client.account_error = False
        bot.run_once()
        self.assertEqual(len(self.client.posts), 1)
        self.assertEqual(bot.repository.load().position, Position.LONG)

    def test_terminal_partial_sell_keeps_remaining_tradable_btc_long(self):
        self.market.data = candles([100] * 5 + [50])
        bot = self.make_bot(live=True)
        self.client.btc, self.client.status = "1.5", "EXPIRED"
        result = bot.run_once()
        self.assertEqual(result["side"], "SELL")
        self.assertEqual(bot.repository.load().quantity, D("0.5"))
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertIsNone(bot.repository.load().pending_order)

    def test_new_unfilled_order_does_not_change_position(self):
        bot = self.make_bot(live=True)
        self.client.status, self.client.fill_qty = "NEW", "0"
        bot.run_once()
        self.assertEqual(bot.repository.load().position, Position.CASH)
        self.assertIsNotNone(bot.repository.load().pending_order)
        self.assertIsNone(bot.repository.load().last_processed_open_time)
        self.assertEqual(bot.repository.records("trades"), [])

    def test_unsent_persisted_intent_rechecks_existing_position_on_recovery(self):
        bot = self.make_bot(live=True)
        original_submit_pending = bot._submit_pending
        bot._submit_pending = lambda *_: (_ for _ in ()).throw(RuntimeError("crash before attempted flag"))
        with self.assertRaises(RuntimeError):
            bot.run_once()
        self.assertFalse(bot.repository.load().pending_order["attempted"])
        bot._submit_pending = original_submit_pending
        self.client.btc = "1"
        bot.run_once()
        self.assertEqual(self.client.posts, [])
        self.assertEqual(bot.repository.load().position, Position.LONG)
        self.assertIsNone(bot.repository.load().pending_order)

    def test_dry_run_all_in_leaves_exact_zero_cash(self):
        bot = self.make_bot()
        bot.run_once()
        self.assertEqual(bot.repository.load().cash, D(0))
