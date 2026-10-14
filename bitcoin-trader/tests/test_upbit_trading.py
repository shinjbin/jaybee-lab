from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlencode

import requests

from config import Settings
from main import build_bot
from hybrid_market import BinanceSignalUpbitExecutionMarket
from test_startup_health import FakeBinance
from models import BotState, Position, Signal
from order_executor import D, SimulatedOrderExecutor
from periodic_status import PeriodicStatus
from startup_health import StartupHealth, StartupSettings
from state_repository import StateRepository
from strategy import BollingerBreakoutStrategy
from trading_bot import PendingOrderUncertain, TradingBot
from upbit_trading import UpbitClient, UpbitMarketDataClient, UpbitOrderExecutor, UpbitRequestError, UpbitRules
from test_binance import response
from test_bot import FakeMarket
from test_strategy import DAY


def settings(**kwargs):
    return Settings(exchange="upbit", symbol="KRW-BTC", base_url="https://api.upbit.com",
                    bollinger_period=5, bollinger_stddev=1, history_limit=20,
                    api_key="test-key", api_secret="test-secret", **kwargs)


def chance():
    return {"bid_fee": "0.0005", "ask_fee": "0.0005", "market": {
        "id": "KRW-BTC", "state": "active", "order_sides": ["bid", "ask"],
        "bid_types": ["price"], "ask_types": ["market"], "max_total": "1000000000",
        "bid": {"currency": "KRW", "min_total": "5"}, "ask": {"currency": "BTC", "min_total": "5"}}}


def day_row(index):
    return {"market": "KRW-BTC", "candle_date_time_utc": datetime.fromtimestamp(index * DAY / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
            "opening_price": 100, "high_price": 100, "low_price": 100, "trade_price": 100,
            "candle_acc_trade_volume": 1, "timestamp": index * DAY + 1000}


def order(**changes):
    result = {"market": "KRW-BTC", "side": "bid", "uuid": "uuid-1", "identifier": "id-1",
              "state": "done", "executed_volume": "1", "paid_fee": "0.1",
              "trades": [{"volume": "1", "funds": "200", "created_at": "1970-01-07T00:00:00Z"}]}
    result.update(changes)
    return result


class FakeUpbit:
    def __init__(self, conf):
        self.settings = conf
        self.btc, self.krw, self.locked = "0", "10000", "0"
        self.posts, self.open = [], []
        self.current = None
        self.test_calls = []
        self.submit_error, self.query_error = None, None
        self.order_state = "done"

    def server_time(self):
        return 6 * DAY

    def symbol_info(self):
        return {"symbol": "KRW-BTC"}

    def request(self, method, path, params=None):
        if method == "GET" and path == "/v1/ticker":
            return [{"market": "KRW-BTC", "trade_price": 210}]
        if method != "GET" or path != "/v1/candles/days":
            raise AssertionError("Unexpected request")
        return [day_row(i) for i in reversed(range(6))]

    def chance(self):
        return chance()

    def account(self):
        return {"balances": [{"asset": "BTC", "free": self.btc, "locked": self.locked},
                             {"asset": "KRW", "free": self.krw, "locked": "0"}]}

    def open_orders(self):
        return self.open

    def test_market_buy(self):
        self.test_calls.append({"market": self.settings.symbol, "price": chance()["market"]["bid"]["min_total"]})
        return {"market": self.settings.symbol, "price": chance()["market"]["bid"]["min_total"]}

    def submit_order(self, params):
        self.posts.append(dict(params))
        self.current = order(identifier=params["identifier"], side=params["side"], state=self.order_state)
        self.btc, self.krw = ("1", "9799.9") if params["side"] == "bid" else ("0", "10199.9")
        if self.submit_error:
            raise self.submit_error
        return UpbitClient.normalize_order(self, self.current)

    def query_order(self, client_id):
        if self.query_error:
            raise self.query_error
        return UpbitClient.normalize_order(self, self.current)


class UpbitTransportTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.client = UpbitClient(settings(), session=self.session, sleep=Mock(), clock=lambda: 0)

    def test_signed_json_and_array_query_hash_match_exact_request(self):
        for method, path, params in (("POST", "/v1/orders", {"market": "KRW-BTC", "side": "bid", "ord_type": "price", "price": "5000"}),
                                    ("GET", "/v1/orders/open", {"market": "KRW-BTC", "states[]": ["wait", "watch"]})):
            self.session.request.return_value = response({"ok": True})
            self.client.request(method, path, params, signed=True)
            sent = self.session.request.call_args.kwargs
            token = sent["headers"]["Authorization"].split()[1]
            payload = token.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            expected = hashlib.sha512(unquote(urlencode(params, doseq=True)).encode()).hexdigest()
            self.assertEqual(claims["query_hash"], expected)
            self.assertEqual(sent["json" if method == "POST" else "params"], params)
            self.assertFalse(sent["allow_redirects"])

    def test_post_timeout_and_5xx_never_retry_or_leak_secrets(self):
        for failure in (requests.Timeout("test-secret"), response({"error": {"name": "internal", "message": "test-secret"}}, 503)):
            self.session.request.reset_mock(side_effect=True)
            if isinstance(failure, Exception):
                self.session.request.side_effect = failure
            else:
                self.session.request.return_value = failure
            with self.assertRaises(UpbitRequestError) as caught:
                self.client.request("POST", "/v1/orders", signed=True)
            self.assertTrue(caught.exception.uncertain)
            self.assertEqual(self.session.request.call_count, 1)
            self.assertNotIn("test-secret", str(caught.exception))

    def test_order_not_found_maps_to_recovery_and_duplicate_is_uncertain(self):
        self.session.request.return_value = response({"error": {"name": "order_not_found"}}, 404)
        with self.assertRaises(UpbitRequestError) as caught:
            self.client.query_order("test")
        self.assertEqual(caught.exception.code, -2013)
        self.session.request.return_value = response({"error": {"name": "duplicate_identifier"}}, 400)
        with self.assertRaises(UpbitRequestError) as caught:
            self.client.request("POST", "/v1/orders", signed=True)
        self.assertTrue(caught.exception.uncertain)

    def test_request_limit_blocks_all_requests(self):
        self.session.request.return_value = response({"error": {"name": "too_many_requests"}}, 429, {"Retry-After": "30"})
        with self.assertRaises(UpbitRequestError):
            self.client.request("GET", "/v1/ticker")
        with self.assertRaises(UpbitRequestError) as caught:
            self.client.request("POST", "/v1/orders", signed=True)
        self.assertEqual(caught.exception.retry_after, 30)
        self.assertEqual(self.session.request.call_count, 1)

    def test_server_time_uses_http_date_and_requires_it(self):
        self.session.request.return_value = response([], headers={"Date": "Thu, 01 Jan 1970 00:00:10 GMT"})
        self.assertEqual(self.client.server_time(), 8000)
        self.session.request.return_value = response([])
        with self.assertRaises(ValueError):
            self.client.server_time()

    def test_closed_candles_ignore_last_trade_timestamp_and_running_day(self):
        self.session.request.return_value = response([day_row(i) for i in reversed(range(4))])
        candles = UpbitMarketDataClient(self.client).closed_candles(3 * DAY)
        self.assertEqual([c.open_time for c in candles], [0, DAY, 2 * DAY])
        self.assertEqual(candles[-1].close_time, 3 * DAY - 1)
        self.session.request.return_value = response([day_row(2), day_row(0)])
        with self.assertRaises(ValueError):
            UpbitMarketDataClient(self.client).closed_candles(3 * DAY)

    def test_history_paginates_backwards_and_excludes_unclosed_rows(self):
        self.session.request.side_effect = [response([], headers={"Date": "Sun, 04 Jan 1970 00:00:02 GMT"}),
                                           response([day_row(2), day_row(1)]), response([day_row(0)])]
        candles = UpbitMarketDataClient(self.client).history(0, 5 * DAY)
        self.assertEqual([c.open_time for c in candles], [0, DAY, 2 * DAY])
        self.assertIn("1970-01-02", self.session.request.call_args.kwargs["params"]["to"])

    def test_cancel_with_executed_volume_is_a_completed_trade(self):
        normalized = self.client.normalize_order(order(state="cancel"))
        self.assertEqual(normalized["status"], "CANCELED")
        self.assertEqual(normalized["executedQty"], "1")
        self.assertEqual(normalized["cummulativeQuoteQty"], "200")


class UpbitBotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = settings(dry_run=False, state_path=self.tmp.name + "/upbit-live.sqlite3")
        self.client = FakeUpbit(self.settings)
        self.market = FakeMarket()
        self.repo = StateRepository(self.settings.state_path, "upbit-live", BotState())
        self.executor = UpbitOrderExecutor(self.client)
        self.bot = TradingBot(self.settings, self.market, BollingerBreakoutStrategy(5, 1), self.executor, self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def test_buy_uses_upbit_balance_fee_and_identifier_and_is_not_repeated(self):
        result = self.bot.run_once()
        params = self.client.posts[0]
        self.assertEqual(params["side"], "bid")
        self.assertEqual(params["ord_type"], "price")
        self.assertEqual(params["price"], "9995")
        self.assertNotIn("volume", params)
        self.assertEqual(result["fee"], {"KRW": "0.1"})
        self.assertEqual(result["exchange"], "upbit")
        self.assertFalse(result["dry_run"])
        self.assertEqual(self.repo.load().position, Position.LONG)
        self.assertIsNone(self.bot.run_once())
        self.assertEqual(len(self.client.posts), 1)
        message = PeriodicStatus(self.bot)._snapshot(6 * DAY / 1000)
        self.assertIn("거래소: UPBIT", message)
        self.assertIn("최근 체결: 실거래 매수", message)

    def test_sell_uses_free_btc_and_blocks_locked_balance(self):
        self.client.btc = "1.123456789"
        intent = self.executor.prepare(Signal.SELL, BotState(), 210, 1)
        self.assertEqual(intent["params"]["ord_type"], "market")
        self.assertEqual(intent["params"]["side"], "ask")
        self.assertEqual(intent["params"]["volume"], "1.12345678")
        self.assertNotIn("price", intent["params"])
        self.client.locked = "0.00000001"
        with self.assertRaises(ValueError):
            self.executor.prepare(Signal.SELL, BotState(), 210, 1)

    def test_existing_position_and_open_order_prevent_buy(self):
        self.client.btc = "1"
        self.assertEqual(self.bot.run_once()["signal"], "HOLD")
        self.assertEqual(self.client.posts, [])
        self.client.btc = "0"
        self.repo.save(BotState())
        self.client.open = [{"state": "watch"}]
        result = self.bot.run_once()
        self.assertIn("Open Upbit orders", result["order_error"])
        self.assertEqual(self.client.posts, [])

    def test_timeout_recovers_by_identifier_without_resubmission(self):
        self.client.submit_error = UpbitRequestError(status=504, uncertain=True)
        with self.assertRaises(PendingOrderUncertain):
            self.bot.run_once()
        self.assertIsNotNone(self.repo.load().pending_order)
        result = self.bot.run_once()
        self.assertEqual(result["side"], "BUY")
        self.assertIsNone(self.repo.load().pending_order)
        self.assertEqual(len(self.client.posts), 1)

    def test_missing_uncertain_order_stays_pending(self):
        self.client.submit_error = UpbitRequestError(uncertain=True)
        with self.assertRaises(PendingOrderUncertain):
            self.bot.run_once()
        self.client.query_error = UpbitRequestError("order_not_found", 404)
        with self.assertRaises(PendingOrderUncertain):
            self.bot.run_once()
        self.assertIsNotNone(self.repo.load().pending_order)
        self.assertEqual(len(self.client.posts), 1)

    def test_partial_cancel_keeps_fills_and_completes_without_rebuy(self):
        self.client.order_state = "wait"
        self.assertIsNone(self.bot.run_once())
        self.assertIsNotNone(self.repo.load().pending_order)
        self.client.current["state"] = "cancel"
        result = self.bot.run_once()
        self.assertEqual(result["status"], "CANCELED")
        self.assertEqual(result["quantity"], "1")
        self.assertEqual(self.repo.load().position, Position.LONG)
        self.assertIsNone(self.bot.run_once())
        self.assertEqual(len(self.client.posts), 1)

    def test_incomplete_fill_history_stays_pending(self):
        self.client.order_state = "wait"
        self.bot.run_once()
        self.client.current.update(state="done", trades=[])
        with self.assertRaises(ValueError):
            self.bot.run_once()
        self.assertIsNotNone(self.repo.load().pending_order)
        self.assertEqual(len(self.client.posts), 1)

    def test_minimum_maximum_and_fee_from_order_policy(self):
        policy = chance()
        policy["market"]["bid"]["min_total"] = "5000"
        policy["market"]["max_total"] = "10000"
        rules = UpbitRules(policy, "KRW-BTC")
        for amount in ("0", "4999", "10001"):
            with self.assertRaises(ValueError):
                rules.validate_amount(D(amount), rules.bid_min)
        rules.validate_amount(D("5000"), rules.bid_min)

    def test_dry_run_build_uses_binance_signals_and_upbit_execution_prices(self):
        with patch("main.BinanceClient") as binance:
            bot = build_bot(replace(self.settings, dry_run=True, state_path=self.tmp.name + "/dry.sqlite3"))
            self.assertIsInstance(bot.market, BinanceSignalUpbitExecutionMarket)
            self.assertIsInstance(bot.executor, SimulatedOrderExecutor)
            binance.assert_called_once()
            public_settings = binance.call_args.args[0]
            self.assertEqual(public_settings.symbol, "BTCUSDT")
            self.assertEqual(public_settings.api_key, "")
            self.assertEqual(public_settings.api_secret, "")

    def test_startup_checks_both_sources_without_binance_auth_or_any_orders(self):
        with patch("startup_health.BinanceClient") as binance:
            source = FakeBinance(self.settings.signal_settings)
            health = StartupHealth(self.settings, StartupSettings(), False, binance=source, upbit=self.client)
            self.assertTrue(health.check().ready)
            binance.assert_not_called()
        self.assertEqual(self.client.posts, [])
        self.assertEqual(source.account_called, 0)
        self.assertIn("Signal market: BINANCE BTCUSDT", health.check().message())
        self.client.account = Mock(side_effect=UpbitRequestError("out_of_scope", 401))
        self.assertFalse(health.check().ready)

    def test_environment_selects_upbit_keys_and_separate_state(self):
        with patch.dict(os.environ, {"DRY_RUN": "false", "UPBIT_ACCESS_KEY": "upbit-key", "UPBIT_SECRET_KEY": "upbit-secret",
                                     "BINANCE_API_KEY": "wrong-key", "BINANCE_API_SECRET": "wrong-secret"}, clear=True):
            conf = Settings.from_env()
        self.assertEqual(conf.exchange, "upbit")
        self.assertEqual(conf.symbol, "KRW-BTC")
        self.assertEqual(conf.api_key, "upbit-key")
        self.assertEqual(conf.state_path, "data/upbit-live.sqlite3")
        self.assertFalse(conf.dry_run)
        with patch.dict(os.environ, {"TRADING_EXCHANGE": "binance"}, clear=True):
            self.assertEqual(Settings.from_env().state_path, "data/dry-run.sqlite3")
        with self.assertRaises(ValueError):
            replace(self.settings, symbol="BTCUSDT")
        with self.assertRaises(ValueError):
            replace(self.settings, interval="1h")
