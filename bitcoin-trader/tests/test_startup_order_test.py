import tempfile
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

from main import main
from models import BotState
from startup_health import StartupHealth, StartupSettings
from state_repository import StateRepository
from upbit_trading import UpbitClient, UpbitRequestError
from test_binance import response
from test_startup_health import FakeBinance
from test_upbit_trading import FakeUpbit, settings, chance


class OrderTestTransportTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.client = UpbitClient(settings(), session=self.session, sleep=Mock())
        self.policy = chance()
        self.policy["market"]["bid"]["min_total"] = "5000"
        self.result = {"market": "KRW-BTC", "side": "bid", "ord_type": "price", "price": "5000",
                       "executed_volume": "0", "uuid": "synthetic-test-id"}

    def test_uses_only_test_endpoint_and_discards_synthetic_order_id(self):
        self.session.request.side_effect = [response(self.policy), response(self.result, 201)]
        result = self.client.test_market_buy()
        self.assertEqual(result, {"market": "KRW-BTC", "price": "5000"})
        first, last = self.session.request.call_args_list
        self.assertEqual(first.args, ("GET", "https://api.upbit.com/v1/orders/chance"))
        self.assertEqual(last.args, ("POST", "https://api.upbit.com/v1/orders/test"))
        self.assertEqual(last.kwargs["json"], {"market": "KRW-BTC", "side": "bid", "ord_type": "price", "price": "5000"})
        self.assertIn("Authorization", last.kwargs["headers"])
        self.assertNotIn("uuid", result)
        self.assertNotIn("identifier", last.kwargs["json"])
        self.assertNotIn("volume", last.kwargs["json"])

    def test_policy_minimum_is_used_instead_of_fixed_amount(self):
        self.policy["market"]["bid"]["min_total"] = "10000"
        self.result["price"] = "10000"
        self.session.request.side_effect = [response(self.policy), response(self.result, 201)]
        self.assertEqual(self.client.test_market_buy()["price"], "10000")

    def test_post_failure_never_retries_or_falls_back_to_real_order(self):
        self.session.request.side_effect = [response(self.policy),
            response({"error": {"name": "out_of_scope", "message": "test-secret"}}, 401)]
        with self.assertRaises(UpbitRequestError) as caught:
            self.client.test_market_buy()
        self.assertEqual(self.session.request.call_count, 2)
        self.assertEqual(self.session.request.call_args.args[1], "https://api.upbit.com/v1/orders/test")
        self.assertNotIn("test-secret", str(caught.exception))

    def test_bad_response_is_not_reported_as_success(self):
        for changes in ({"market": "KRW-ETH"}, {"side": "ask"}, {"executed_volume": "1"}, {"price": "1"}):
            self.session.request.side_effect = [response(self.policy), response({**self.result, **changes}, 201)]
            with self.assertRaises(ValueError):
                self.client.test_market_buy()

    def test_missing_keys_skip_all_requests(self):
        client = UpbitClient(replace(settings(), api_key="", api_secret=""), session=self.session)
        with self.assertRaises(ValueError):
            client.test_market_buy()
        self.session.request.assert_not_called()


class StartupOrderTestTests(unittest.TestCase):
    def setUp(self):
        self.conf = settings()
        self.upbit = FakeUpbit(self.conf)
        self.binance = FakeBinance(self.conf.signal_settings)
        self.startup = StartupSettings()

    def report(self, dry=True, conf=None, startup=None):
        return StartupHealth(conf or self.conf, startup or self.startup, dry, self.binance, self.upbit).check()

    def test_startup_calls_test_once_even_in_simulation_and_reports_no_fill(self):
        report = self.report()
        self.assertTrue(report.ready)
        self.assertEqual(len(self.upbit.test_calls), 1)
        self.assertEqual(self.upbit.posts, [])
        self.assertIn("Upbit 주문 테스트", report.message())
        self.assertIn("실제 주문·체결 없음", report.message())

    def test_test_failure_blocks_live_but_reports_failure_in_simulation(self):
        self.upbit.test_market_buy = Mock(side_effect=UpbitRequestError("out_of_scope", 401))
        self.assertFalse(self.report(False).ready)
        dry = self.report(True)
        self.assertTrue(dry.ready)
        self.assertEqual(dry.results[-1].status, "failed")
        self.assertIn("권한 확인", dry.results[-1].detail)
        self.assertEqual(self.upbit.posts, [])

    def test_missing_keys_is_explicit_and_does_not_test(self):
        conf = replace(self.conf, api_key="", api_secret="")
        report = self.report(conf=conf)
        self.assertEqual(report.results[-1].status, "unconfigured")
        self.assertEqual(self.upbit.test_calls, [])
        self.assertFalse(self.report(False, conf=conf).ready)

    def test_disabled_test_is_explicit_and_does_not_call_endpoint(self):
        report = self.report(False, startup=replace(self.startup, order_test_enabled=False))
        self.assertTrue(report.ready)
        self.assertEqual(report.results[-1].status, "skipped")
        self.assertEqual(self.upbit.test_calls, [])
        self.assertIn("설정으로 비활성화", report.message())

    def test_startup_test_does_not_save_order_intent_or_trade(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = StateRepository(tmp + "/state.sqlite3", "test", BotState())
            before = repo.load()
            self.report()
            self.assertEqual(repo.load(), before)
            self.assertEqual(repo.records("trades"), [])
            self.assertEqual(repo.records("decisions"), [])

    def test_check_connections_runs_test_then_exits_without_trading_loop(self):
        health = StartupHealth(self.conf, self.startup, True, self.binance, self.upbit)
        with patch.dict("os.environ", {}, clear=True), patch("sys.argv", ["main.py", "--check-connections"]), \
             patch("main.StartupHealth", return_value=health), patch("main.StartupNotifier") as notifier, \
             patch("main.build_bot") as build:
            main()
        self.assertEqual(len(self.upbit.test_calls), 1)
        self.assertEqual(self.upbit.posts, [])
        build.assert_not_called()
        notifier.return_value.notify.assert_called_once()
