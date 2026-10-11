from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

import requests

import main as entrypoint
from binance_client import BinanceError
from config import Settings
from models import BotState
from startup_health import CheckResult, HealthReport, StartupHealth, StartupNotifier, StartupSettings
from state_repository import StateRepository
from telegram_client import send
from upbit_client import UpbitError, UpbitHealthClient
from test_binance import response, row
from test_strategy import DAY


class FakeBinance:
    def __init__(self, settings):
        self.settings = settings
        self.account_error = None
        self.market_error = None
        self.can_trade = True
        self.account_called = 0

    def server_time(self):
        return 6 * DAY

    def symbol_info(self):
        return {"symbol": "BTCUSDT"}

    def request(self, method, path, params=None):
        if method != "GET" or path != "/api/v3/klines":
            raise AssertionError("Unexpected request, possibly an order")
        if self.market_error:
            raise self.market_error
        return [row(i) for i in range(6)]

    def account(self):
        self.account_called += 1
        if self.account_error:
            raise self.account_error
        return {"balances": [], "canTrade": self.can_trade}


class StartupHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings(bollinger_period=5, bollinger_stddev=1, history_limit=20,
                                 api_key="binance-secret", api_secret="binance-signing-secret")
        self.startup = StartupSettings(upbit_access_key="upbit-secret", upbit_secret_key="upbit-signing-secret",
            telegram_token="telegram-secret", telegram_chat_id="123", pod_name="trader-pod",
            version="commit1", notification_state_path=self.tmp.name + "/health.sqlite3")
        self.binance = FakeBinance(self.settings)
        self.upbit = Mock()
        self.upbit.check_account.return_value = None

    def tearDown(self):
        self.tmp.cleanup()

    def health(self, dry_run=True, settings=None, startup=None):
        return StartupHealth(settings or self.settings, startup or self.startup, dry_run,
                             self.binance, self.upbit)

    def test_successful_check_reports_all_items_and_no_balances_or_credentials(self):
        report = self.health(dry_run=False).check()
        self.assertTrue(report.ready)
        self.assertEqual([r.status for r in report.results], ["ok"] * 5)
        message = report.message()
        self.assertIn("DRY_RUN: false", message)
        self.assertIn("trader-pod", message)
        self.assertIn("commit1", message)
        self.assertIn("KST", message)
        self.assertNotIn("secret", message)
        self.upbit.check_account.assert_called_once()

    def test_missing_keys_are_explicit_and_skip_authenticated_requests(self):
        settings = replace(self.settings, api_key="", api_secret="")
        startup = replace(self.startup, upbit_access_key="", upbit_secret_key="")
        report = self.health(settings=settings, startup=startup).check()
        self.assertEqual([r.status for r in report.results], ["ok", "ok", "ok", "unconfigured", "unconfigured"])
        self.assertTrue(report.ready)
        self.assertEqual(self.binance.account_called, 0)
        self.upbit.check_account.assert_not_called()
        self.assertIn("인증 확인 불가", report.message())
        self.assertFalse(self.health(False, settings, startup).check().ready)

    def test_binance_failure_does_not_skip_upbit_and_blocks_trading(self):
        self.binance.market_error = requests.Timeout("signed URL with binance-secret")
        report = self.health().check()
        self.assertFalse(report.ready)
        self.assertEqual(report.results[2].detail, "응답 시간 초과")
        self.assertEqual(report.results[-1].status, "ok")
        self.assertEqual(self.binance.account_called, 1)
        self.upbit.check_account.assert_called_once()
        self.assertNotIn("secret", report.message())

    def test_upbit_failure_is_reported_but_does_not_block_binance(self):
        self.upbit.check_account.side_effect = requests.ConnectionError("upbit-secret bearer JWT")
        report = self.health(False).check()
        self.assertTrue(report.ready)
        self.assertEqual(report.results[-1].status, "failed")
        self.assertEqual(report.results[-1].detail, "네트워크 연결 실패")
        self.assertNotIn("secret", report.message())

    def test_invalid_binance_keys_block_live_but_dry_run_can_use_public_data(self):
        self.binance.account_error = BinanceError(code=-2015, status=401)
        live = self.health(False).check()
        dry = self.health(True).check()
        self.assertFalse(live.ready)
        self.assertTrue(dry.ready)
        self.assertIn("API 키·허용 IP·권한", live.results[3].detail)

    def test_no_trading_permission_is_checked_separately_from_authentication(self):
        self.binance.can_trade = False
        self.assertFalse(self.health(False).check().ready)
        dry = self.health(True).check()
        self.assertTrue(dry.ready)
        self.assertIn("거래 권한 없음", dry.results[3].detail)

    def test_notification_persists_and_suppresses_restarts_but_not_new_versions(self):
        sender = Mock(return_value=True)
        report = self.health().check()
        notifier = StartupNotifier(self.startup, sender, clock=lambda: 10000)
        self.assertEqual(notifier.notify(report), "delivered")
        restarted = StartupNotifier(self.startup, sender, clock=lambda: 10001)
        self.assertEqual(restarted.notify(replace(report, pod_name="replacement-pod", started_at="later")), "suppressed")
        self.assertEqual(restarted.notify(replace(report, version="commit2")), "delivered")
        self.assertEqual(sender.call_count, 2)
        self.assertEqual(sender.call_args.kwargs["chat_id"], "123")
        self.assertEqual(notifier.notify(replace(report, dry_run=False)), "delivered")

    def test_changed_status_sends_again_and_cooldown_expiry_allows_retry(self):
        sender = Mock(return_value=True)
        report = self.health().check()
        notifier = StartupNotifier(self.startup, sender, clock=lambda: 10000)
        notifier.notify(report)
        failed = replace(report, results=[CheckResult("Binance", "failed", "응답 시간 초과", True)])
        self.assertEqual(notifier.notify(failed), "delivered")
        self.assertEqual(notifier.notify(report), "delivered")  # Recovery must notify even within cooldown.
        expired = StartupNotifier(self.startup, sender, clock=lambda: 13600)
        self.assertEqual(expired.notify(report), "delivered")

    def test_failed_or_uncertain_notification_is_not_reported_delivered_and_is_limited(self):
        sender = Mock(return_value=False)
        report = self.health().check()
        notifier = StartupNotifier(self.startup, sender, clock=lambda: 10000)
        self.assertEqual(notifier.notify(report), "failed")
        self.assertEqual(notifier.notify(report), "suppressed")
        repository = StateRepository(self.startup.notification_state_path, "startup-health-notifications", BotState())
        self.assertFalse(repository.notification(notifier.receipt_key(report))["delivered"])
        self.assertEqual(sender.call_count, 1)

    def test_sender_exception_preserves_reservation_without_leaking_secret(self):
        sender = Mock(side_effect=requests.Timeout("token=telegram-secret"))
        notifier = StartupNotifier(self.startup, sender, clock=lambda: 10000)
        report = self.health().check()
        with self.assertLogs("startup_health", level="INFO") as logs:
            self.assertEqual(notifier.notify(report), "failed")
            self.assertEqual(notifier.notify(report), "suppressed")
        self.assertNotIn("telegram-secret", " ".join(logs.output))
        self.assertEqual(sender.call_count, 1)

    def test_missing_telegram_config_does_not_send_or_block_startup(self):
        sender = Mock()
        notifier = StartupNotifier(replace(self.startup, telegram_token=""), sender)
        self.assertEqual(notifier.notify(self.health().check()), "unconfigured")
        sender.assert_not_called()

    def test_check_only_does_not_build_trading_bot(self):
        report = self.health().check()
        with patch.dict(os.environ, {"DRY_RUN": "true"}, clear=True), \
             patch("sys.argv", ["main.py", "--check-connections"]), \
             patch("main.StartupHealth") as checker, patch("main.StartupNotifier") as notifier, \
             patch("main.build_bot") as build:
            checker.return_value.check.return_value = report
            notifier.return_value.notify.return_value = "delivered"
            entrypoint.main()
            notifier.return_value.notify.assert_called_once_with(report)
            build.assert_not_called()

    def test_live_missing_keys_is_notified_before_startup_is_blocked(self):
        report = self.health(False, replace(self.settings, api_key="", api_secret="")).check()
        with patch.dict(os.environ, {"DRY_RUN": "false"}, clear=True), \
             patch("sys.argv", ["main.py", "--once"]), patch("main.StartupHealth") as checker, \
             patch("main.StartupNotifier") as notifier, patch("main.build_bot") as build:
            checker.return_value.check.return_value = report
            with self.assertRaises(SystemExit) as error:
                entrypoint.main()
            self.assertEqual(error.exception.code, 1)
            notifier.return_value.notify.assert_called_once_with(report)
            build.assert_not_called()

    def test_notification_failure_does_not_prevent_healthy_trading_start(self):
        report = self.health().check()
        with patch.dict(os.environ, {"DRY_RUN": "true"}, clear=True), \
             patch("sys.argv", ["main.py", "--once"]), patch("main.StartupHealth") as checker, \
             patch("main.StartupNotifier") as notifier, patch("main.build_bot") as build, \
             patch("main.signal.signal"):
            checker.return_value.check.return_value = report
            notifier.return_value.notify.return_value = "failed"
            entrypoint.main()
            build.return_value.run_once.assert_called_once()


class UpbitAndTelegramTests(unittest.TestCase):
    def test_upbit_jwt_hs512_nonce_and_read_only_endpoint(self):
        session = Mock()
        session.get.return_value = response([])
        client = UpbitHealthClient("https://api.upbit.com", "access-key", "signing-key", session=session)
        client.check_account()
        first = session.get.call_args.kwargs["headers"]["Authorization"].split(" ")[1]
        client.check_account()
        second = session.get.call_args.kwargs["headers"]["Authorization"].split(" ")[1]
        self.assertNotEqual(first, second)
        header, payload, signature = first.split(".")
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        self.assertEqual(json.loads(decode(header)), {"alg": "HS512", "typ": "JWT"})
        self.assertEqual(json.loads(decode(payload))["access_key"], "access-key")
        self.assertNotIn("query_hash", json.loads(decode(payload)))
        expected = hmac.new(b"signing-key", f"{header}.{payload}".encode(), hashlib.sha512).digest()
        self.assertEqual(decode(signature), expected)
        self.assertEqual(session.get.call_args.args[0], "https://api.upbit.com/v1/accounts")
        session.post.assert_not_called()

    def test_upbit_error_body_is_sanitized_and_permission_failure_is_explicit(self):
        session = Mock()
        session.get.return_value = response({"error": {"name": "out_of_scope", "message": "signing-key"}}, 401)
        client = UpbitHealthClient("https://api.upbit.com", "key", "signing-key", session=session)
        with self.assertRaises(UpbitError) as exc:
            client.check_account()
        self.assertIn("자산조회 권한", str(exc.exception))
        self.assertNotIn("signing-key", str(exc.exception))

    def test_upbit_malformed_success_is_not_treated_as_connected(self):
        session = Mock()
        client = UpbitHealthClient("https://api.upbit.com", "key", "secret", session=session)
        for payload in ({}, ["invalid"], [{"currency": "BTC"}]):
            session.get.return_value = response(payload)
            with self.subTest(payload=payload), self.assertRaises(UpbitError):
                client.check_account()

    def test_telegram_checks_api_ok_and_does_not_use_html(self):
        session = Mock()
        session.post.return_value = response({"ok": True})
        self.assertTrue(send("Pod: <name>", token="token", chat_id="123", session=session))
        self.assertEqual(session.post.call_args.kwargs["json"], {"chat_id": "123", "text": "Pod: <name>"})
        session.post.return_value = response({"ok": False})
        self.assertFalse(send("message", token="token", chat_id="123", session=session))

    def test_telegram_timeout_does_not_expose_token_or_claim_success(self):
        session = Mock()
        session.post.side_effect = requests.Timeout("https://api.telegram.org/botSECRET/sendMessage")
        with self.assertLogs("telegram_client", level="WARNING") as logs:
            self.assertFalse(send("message", token="SECRET", chat_id="123", session=session))
        self.assertNotIn("SECRET", " ".join(logs.output))
