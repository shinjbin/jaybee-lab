import tempfile
import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock, patch

from config import Settings
from models import BotState, Position
from periodic_status import PeriodicStatus, StatusSettings
from state_repository import StateRepository
from strategy import BollingerBreakoutStrategy
from test_bot import FakeMarket
from test_strategy import candles


class PeriodicStatusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repository = StateRepository(self.tmp.name + "/state.sqlite3", "test", BotState())
        self.bot = SimpleNamespace(settings=Settings(), repository=self.repository,
                                   market=FakeMarket(), strategy=BollingerBreakoutStrategy(5, 1))
        self.now = 100000
        self.sender = Mock(return_value=True)
        self.status = self.make_status()

    def tearDown(self):
        self.tmp.cleanup()

    def make_status(self):
        return PeriodicStatus(self.bot, sender=self.sender, clock=lambda: self.now)

    def test_hourly_check_and_six_hour_report_even_without_changes(self):
        with patch.object(self.bot.market, "execution_price", wraps=self.bot.market.execution_price) as price:
            self.assertEqual(self.status.tick(), "delivered")
            for hour in range(1, 6):
                self.now = 100000 + hour * 3600
                self.assertEqual(self.status.tick(), "suppressed")
            self.assertEqual(price.call_count, 6)
            self.assertEqual(self.sender.call_count, 1)
            self.now = 100000 + 21600
            self.assertEqual(self.status.tick(), "delivered")
            self.assertEqual(self.sender.call_count, 2)

    def test_no_queries_between_hourly_checks_and_no_state_mutation(self):
        original = self.repository.load()
        self.status.tick()
        with patch.object(self.bot.market, "server_time") as server_time:
            self.now += 5
            self.status.tick()
            server_time.assert_not_called()
        self.assertEqual(self.repository.load(), original)
        self.assertEqual(self.repository.records("decisions"), [])
        self.assertEqual(self.repository.records("trades"), [])

    def test_restart_preserves_successful_delivery_time(self):
        self.status.tick()
        self.now += 100
        self.assertEqual(self.make_status().tick(), "suppressed")
        self.now = 100000 + 21600
        self.assertEqual(self.make_status().tick(), "delivered")

    def test_failed_delivery_retries_after_hour_and_success_resets_six_hours(self):
        self.sender.return_value = False
        self.assertEqual(self.status.tick(), "failed")
        self.now += 10
        self.assertEqual(self.make_status().tick(), "suppressed")
        self.now = 100000 + 3600
        self.sender.return_value = True
        self.assertEqual(self.status.tick(), "delivered")
        self.now = 100000 + 21600
        self.assertEqual(self.status.tick(), "suppressed")
        self.now += 3600
        self.assertEqual(self.status.tick(), "delivered")

    def test_market_failure_still_reports_without_error_secrets(self):
        self.bot.market.server_time = Mock(side_effect=RuntimeError("secret-token"))
        self.assertEqual(self.status.tick(), "delivered")
        message = self.sender.call_args.args[0]
        self.assertIn("시장 조회: 실패", message)
        self.assertIn("매수 신호: 확인 불가 ⚠️", message)
        self.assertIn("매도 신호: 확인 불가 ⚠️", message)
        self.assertNotIn("secret-token", message)

    def test_sender_exception_is_throttled(self):
        self.sender.side_effect = RuntimeError("secret-token")
        self.assertEqual(self.status.tick(), "failed")
        self.assertEqual(self.status.tick(), "suppressed")

    def test_status_message_contains_price_mode_position_and_signal(self):
        self.status.tick()
        message = self.sender.call_args.args[0]
        for text in ("KST", "BTCUSDT", "모의 매매", "CASH", "210.00", "이동평균", "상단 밴드", "신호"):
            self.assertIn(text, message)

    def test_environment_and_invalid_intervals(self):
        with patch.dict("os.environ", {"STATUS_CHECK_SECONDS": "3600", "STATUS_REPORT_SECONDS": "21600"}):
            self.assertEqual(StatusSettings.from_env(), StatusSettings())
        for invalid in (0, -1, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                StatusSettings(check_seconds=invalid)
            with self.assertRaises(ValueError):
                StatusSettings(report_seconds=invalid)

    def test_buy_signal_does_not_claim_actual_execution(self):
        message = self.status._snapshot(self.now)
        self.assertIn("최근 마감봉 기준 신호: BUY 🟢 ▲ 매수", message)
        self.assertIn("매수 신호: 있음 🟢 ▲", message)
        self.assertIn("매도 신호: 없음 —", message)
        self.assertIn("실제 주문 전송: 비활성", message)
        self.assertIn("최근 체결: 없음", message)
        self.assertEqual(self.repository.records("trades"), [])

    def test_sell_and_hold_signals(self):
        self.repository.save(BotState(position=Position.LONG))
        self.bot.market.data = candles([200] * 5 + [100])
        message = self.status._snapshot(self.now)
        self.assertIn("최근 마감봉 기준 신호: SELL 🔴 ▼ 매도", message)
        self.assertIn("매수 신호: 없음 —", message)
        self.assertIn("매도 신호: 있음 🔴 ▼", message)
        self.bot.market.data = candles([100] * 6)
        message = self.status._snapshot(self.now)
        self.assertIn("최근 마감봉 기준 신호: HOLD ⏸ 대기", message)
        self.assertIn("매수 신호: 없음 —", message)
        self.assertIn("매도 신호: 없음 —", message)

    def test_processed_candle_and_pending_order_block_new_orders(self):
        state = BotState(last_processed_open_time=self.bot.market.data[-1].open_time)
        self.repository.save(state)
        self.assertIn("신규 주문: 없음 (최근 마감봉 처리 완료)", self.status._snapshot(self.now))
        state.pending_order = {"side": "BUY"}
        self.repository.save(state)
        self.assertIn("신규 주문: 대기 (미결 주문 확인 중)", self.status._snapshot(self.now))

    def test_latest_trade_reports_mode_side_and_kst_time(self):
        state = self.repository.load()
        self.repository.save(state, trade={"order_id": "first", "side": "BUY", "dry_run": True,
                                           "execution_time": 0})
        self.assertIn("최근 체결: 모의 매수 / 1970-01-01 09:00:00 KST", self.status._snapshot(self.now))
        self.bot.settings = replace(self.bot.settings, dry_run=False, api_key="test", api_secret="test")
        self.repository.save(state, trade={"order_id": "second", "side": "SELL", "dry_run": False,
                                           "execution_time": 3600000})
        message = self.status._snapshot(self.now)
        self.assertIn("실제 주문 전송: 활성", message)
        self.assertIn("최근 체결: 실거래 매도 / 1970-01-01 10:00:00 KST", message)
        self.assertNotIn("최근 체결: 모의 매수", message)

    def test_trade_without_execution_time_remains_visible_on_market_failure(self):
        self.repository.save(self.repository.load(), trade={"order_id": "test", "side": "SELL",
                                                           "dry_run": False, "execution_time": None})
        self.bot.market.server_time = Mock(side_effect=RuntimeError("secret-token"))
        message = self.status._snapshot(self.now)
        self.assertIn("최근 체결: 실거래 매도 / 시각 확인 불가", message)
        self.assertIn("매수 신호: 확인 불가", message)
