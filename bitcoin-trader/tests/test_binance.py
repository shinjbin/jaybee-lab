from __future__ import annotations

import hashlib
import hmac
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch
from urllib.parse import urlencode

import requests

from binance_client import BinanceClient, BinanceError, BinanceMarketDataClient
from config import Settings, boolean
from order_executor import D, SymbolRules
from test_strategy import DAY


def response(data, status=200, headers=None):
    result = Mock()
    result.status_code = status
    result.headers = headers or {}
    result.json.return_value = data
    return result


def row(index, close=100):
    return [index * DAY, "100", str(max(100, close)), str(min(100, close)), str(close), "1", (index + 1) * DAY - 1]


class BinanceTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(api_key="secret-key", api_secret="secret-secret")
        self.session = Mock()
        self.client = BinanceClient(self.settings, self.session, sleep=Mock())

    def test_closed_candles_excludes_running_day_and_exact_close_boundary(self):
        self.session.request.return_value = response([row(0), row(1), row(2, 1000)])
        market = BinanceMarketDataClient(self.client)
        self.assertEqual(len(market.closed_candles(2 * DAY)), 2)
        self.assertEqual(len(market.closed_candles(2 * DAY - 1)), 1)

    def test_missing_history_and_duplicate_rows_are_rejected(self):
        for rows in ([row(0), row(2)], [row(1), row(1)], [row(2), row(1)]):
            with self.subTest(rows=rows):
                self.session.request.return_value = response(rows)
                with self.assertRaises(ValueError):
                    BinanceMarketDataClient(self.client).closed_candles(3 * DAY)

    def test_stale_data_is_rejected(self):
        self.session.request.return_value = response([row(0)])
        with self.assertRaises(ValueError):
            BinanceMarketDataClient(self.client).closed_candles(3 * DAY)

    def test_hmac_signature_headers_and_server_offset(self):
        self.session.request.return_value = response({"balances": []})
        self.client.offset_ms = 123
        with patch("binance_client.time.time", return_value=100):
            self.client.account()
        kwargs = self.session.request.call_args.kwargs
        params = dict(kwargs["params"])
        signature = params.pop("signature")
        self.assertEqual(params["timestamp"], 100123)
        self.assertEqual(signature, hmac.new(b"secret-secret", urlencode(params).encode(), hashlib.sha256).hexdigest())
        self.assertEqual(kwargs["headers"], {"X-MBX-APIKEY": "secret-key"})

    def test_post_timeout_is_uncertain_and_never_retried(self):
        self.session.request.side_effect = requests.Timeout("potentially sensitive signed URL")
        with self.assertRaises(BinanceError) as error:
            self.client.submit_order({"symbol": "BTCUSDT"})
        self.assertTrue(error.exception.uncertain)
        self.assertEqual(self.session.request.call_count, 1)
        self.assertNotIn("sensitive", str(error.exception))

    def test_post_5xx_and_timeout_code_are_uncertain(self):
        for status, code in [(503, -1000), (400, -1007), (400, -1000), (400, -1001)]:
            with self.subTest(status=status):
                self.session.request.reset_mock()
                self.session.request.return_value = response({"code": code}, status)
                with self.assertRaises(BinanceError) as error:
                    self.client.submit_order({})
                self.assertTrue(error.exception.uncertain)
                self.assertEqual(self.session.request.call_count, 1)

    def test_read_network_errors_and_5xx_retry_with_backoff(self):
        self.session.request.side_effect = [requests.ConnectionError(), response({"code": -1000}, 500),
                                           response({"serverTime": 100})]
        self.assertEqual(self.client.server_time(), 100)
        self.assertEqual(self.session.request.call_count, 3)
        self.assertEqual([c.args[0] for c in self.client.sleep.call_args_list], [1, 2])

    def test_rate_limit_honors_retry_after_and_blocks_other_endpoints(self):
        self.session.request.return_value = response({"code": -1003}, 429, {"Retry-After": "120"})
        with self.assertRaises(BinanceError) as error:
            self.client.server_time()
        self.assertEqual(error.exception.retry_after, 120)
        with self.assertRaises(BinanceError):
            self.client.account()
        self.assertEqual(self.session.request.call_count, 1)

    def test_history_paginates_and_excludes_open_candle(self):
        self.session.request.side_effect = [response({"serverTime": 3 * DAY}),
                                           response([row(0), row(1)]), response([row(2), row(3)])]
        candles = BinanceMarketDataClient(self.client).history(0, 5 * DAY)
        self.assertEqual([c.open_time for c in candles], [0, DAY, 2 * DAY])
        self.assertEqual(self.session.request.call_args.kwargs["params"]["startTime"], 2 * DAY)

    def test_setting_validation_and_dry_run_defaults(self):
        self.assertTrue(Settings().dry_run)
        self.assertEqual(Settings().bollinger_period, 49)
        self.assertEqual(Settings().bollinger_stddev, 1.8)
        for kwargs in ({"fee_rate": -0.1}, {"slippage_rate": 1}, {"position_size": 2},
                       {"history_limit": 50}, {"bollinger_stddev": float("nan")}, {"dry_run": False}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                Settings(**kwargs)
        with self.assertRaises(ValueError):
            boolean("yes")
        self.assertNotIn("secret-key", repr(self.settings))

    def test_minimum_maximum_and_quantity_steps_apply_to_market_order(self):
        rules = SymbolRules({"baseAsset": "BTC", "quoteAsset": "USDT", "quoteAssetPrecision": 8,
            "filters": [{"filterType": "LOT_SIZE", "minQty": "0.001", "maxQty": "100", "stepSize": "0.001"},
                        {"filterType": "MARKET_LOT_SIZE", "minQty": "0.01", "maxQty": "2", "stepSize": "0.01"},
                        {"filterType": "NOTIONAL", "minNotional": "10", "maxNotional": "150",
                         "applyMinToMarket": True, "applyMaxToMarket": True}]})
        self.assertEqual(rules.rounded_quantity(D("1.239")), D("1.23"))
        for quantity in ("0.09", "1.6", "3"):
            with self.subTest(quantity=quantity), self.assertRaises(ValueError):
                rules.validate(D(quantity), D(100))
        rules.validate(D("1"), D(100))
