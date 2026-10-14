import os
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

from backtest import Backtester
from binance_client import BinanceClient, BinanceError
from config import Settings
from hybrid_market import BinanceSignalUpbitExecutionMarket
from main import build_bot
from models import BotState, Position
from order_executor import D
from periodic_status import PeriodicStatus
from startup_health import StartupHealth, StartupSettings
from state_repository import StateRepository
from strategy import BollingerBreakoutStrategy
from trading_bot import PendingOrderUncertain, TradingBot
from upbit_trading import UpbitOrderExecutor, UpbitRequestError
from test_binance import response, row
from test_bot import FakeMarket
from test_startup_health import FakeBinance
from test_strategy import DAY, candles
from test_upbit_trading import FakeUpbit, settings, chance


class HybridMarketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conf = settings(dry_run=False, state_path=self.tmp.name + "/hybrid.sqlite3")
        self.upbit = FakeUpbit(self.conf)
        self.binance = Mock()
        self.binance.settings = self.conf.signal_settings
        self.market = BinanceSignalUpbitExecutionMarket(self.binance, self.upbit)
        self.market.signal_market = FakeMarket()
        self.repo = StateRepository(self.conf.state_path, "hybrid", BotState())
        self.bot = TradingBot(self.conf, self.market, BollingerBreakoutStrategy(5, 1),
                              UpbitOrderExecutor(self.upbit), self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def test_requests_use_binance_public_candles_and_upbit_ticker(self):
        session = Mock()
        session.request.side_effect = [response({"serverTime": 6 * DAY}),
                                       response([row(i, 200 if i == 5 else 100) for i in range(6)])]
        source = BinanceClient(self.conf.signal_settings, session=session)
        market = BinanceSignalUpbitExecutionMarket(source, self.upbit)
        self.assertEqual(market.closed_candles(market.server_time())[-1].close, 200)
        self.assertEqual(market.execution_price(), 210)
        for call in session.request.call_args_list:
            self.assertEqual(call.args[0], "GET")
            self.assertTrue(call.args[1].startswith("https://api.binance.com/api/v3/"))
            self.assertEqual(call.kwargs["headers"], {})
            self.assertNotIn("signature", call.kwargs["params"])
        self.assertEqual(session.request.call_args.kwargs["params"]["symbol"], "BTCUSDT")
        self.assertEqual(self.upbit.posts, [])

    def test_binance_breakout_creates_only_an_upbit_order(self):
        result = self.bot.run_once()
        self.assertEqual(result["exchange"], "upbit")
        self.assertEqual(self.upbit.posts[0]["market"], "KRW-BTC")
        self.binance.submit_order.assert_not_called()
        self.binance.account.assert_not_called()
        decision = self.repo.records("decisions")[-1]
        self.assertEqual(decision["signal_symbol"], "BTCUSDT")
        self.assertEqual(decision["execution_symbol"], "KRW-BTC")
        self.assertEqual(decision["close"], 200)

    def test_btc_position_uses_krw_price_not_signal_usdt_close(self):
        self.upbit.btc = "0.001"
        self.market.execution_market.execution_price = Mock(return_value=100000000)
        result = self.bot.run_once()
        self.assertEqual(result["signal"], "HOLD")
        self.assertEqual(self.repo.load().position, Position.LONG)
        self.assertEqual(self.upbit.posts, [])

    def test_existing_upbit_btc_sells_on_binance_middle_band_signal(self):
        self.upbit.btc = "1"
        self.market.signal_market.data = candles([200] * 5 + [100])
        result = self.bot.run_once()
        self.assertEqual(result["side"], "SELL")
        self.assertEqual(self.upbit.posts[0]["side"], "ask")
        self.assertEqual(self.upbit.posts[0]["volume"], "1")
        self.assertNotIn("price", self.upbit.posts[0])
        self.assertEqual(self.repo.load().position, Position.CASH)

    def test_signal_failure_prevents_new_orders_without_upbit_candle_fallback(self):
        self.market.signal_market.closed_candles = Mock(side_effect=BinanceError(status=503))
        with patch.object(self.market.execution_market, "closed_candles") as fallback:
            with self.assertRaises(BinanceError):
                self.bot.run_once()
            fallback.assert_not_called()
        self.assertEqual(self.upbit.posts, [])
        self.assertEqual(self.repo.records("decisions"), [])

    def test_execution_price_failure_prevents_order_and_processing(self):
        self.market.execution_market.execution_price = Mock(side_effect=UpbitRequestError(status=503))
        with self.assertRaises(UpbitRequestError):
            self.bot.run_once()
        self.assertEqual(self.upbit.posts, [])
        self.assertIsNone(self.repo.load().last_processed_open_time)

    def test_pending_order_reconciliation_survives_binance_outage(self):
        self.upbit.submit_error = UpbitRequestError(uncertain=True)
        with self.assertRaises(PendingOrderUncertain):
            self.bot.run_once()
        self.market.signal_market.server_time = Mock(side_effect=BinanceError(status=503))
        result = self.bot.run_once()
        self.assertEqual(result["side"], "BUY")
        self.market.signal_market.server_time.assert_not_called()
        self.assertEqual(len(self.upbit.posts), 1)

    def test_status_separates_signal_and_execution_market_units(self):
        message = PeriodicStatus(self.bot)._snapshot(100000)
        for text in ("주문 시장: KRW-BTC", "신호 기준: BINANCE BTCUSDT", "매수 신호: 있음",
                     "주문 시장 현재가 (KRW-BTC): 210.00", "Binance 최근 마감 가격 (BTCUSDT, USDT): 200.00"):
            self.assertIn(text, message)
        self.assertEqual(self.upbit.posts, [])

    def test_startup_signal_failure_blocks_live_but_does_not_skip_upbit_probes(self):
        source = FakeBinance(self.conf.signal_settings)
        source.market_error = BinanceError(status=503)
        with patch.object(self.upbit, "account", wraps=self.upbit.account) as account:
            report = StartupHealth(self.conf, StartupSettings(), False, source, self.upbit).check()
            self.assertFalse(report.ready)
            account.assert_called_once()
        self.assertEqual(source.account_called, 0)
        self.assertEqual(self.upbit.posts, [])

    def test_source_identity_change_rejects_reusing_old_state(self):
        old_path = self.tmp.name + "/old.sqlite3"
        legacy = f"{self.conf.base_url}:{self.conf.symbol}:{self.conf.interval}:live"
        StateRepository(old_path, legacy, BotState())
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            build_bot(replace(self.conf, state_path=old_path))

    def test_public_source_settings_do_not_carry_trading_credentials(self):
        with patch.dict(os.environ, {"UPBIT_ACCESS_KEY": "upbit", "UPBIT_SECRET_KEY": "secret",
                                    "BINANCE_API_KEY": "unused", "BINANCE_API_SECRET": "unused"}, clear=True):
            conf = Settings.from_env()
        self.assertEqual(conf.signal_settings.api_key, "")
        self.assertEqual(conf.signal_settings.api_secret, "")
        self.assertEqual(conf.signal_settings.symbol, "BTCUSDT")
        self.assertEqual(conf.signal_settings.base_url, "https://api.binance.com")
        self.assertTrue(conf.signal_settings.dry_run)
        with self.assertRaises(ValueError):
            replace(conf, signal_symbol="ETHUSDT")
        with patch.dict(os.environ, {"BINANCE_INTERVAL": "1h"}, clear=True), self.assertRaises(ValueError):
            Settings.from_env()

    def test_hybrid_backtest_uses_binance_signals_and_next_upbit_open(self):
        conf = replace(self.conf, initial_cash=100000, fee_rate=0, slippage_rate=0)
        signals = candles([100] * 5 + [200, 300, 50, 80])
        execution = candles([100000000] * 9)
        result = Backtester(conf, self.bot.strategy).run(execution, now_ms=10 * DAY, signal_candles=signals)
        self.assertEqual([t["side"] for t in result["trades"]], ["BUY", "SELL"])
        self.assertEqual(result["trades"][0]["signal_candle"], 5 * DAY)
        self.assertEqual(result["trades"][0]["execution_time"], 6 * DAY)
        self.assertEqual(D(result["trades"][0]["execution_price"]), D(100000000))
        self.assertEqual(D(result["trades"][0]["quantity"]), D("0.001"))
        self.assertEqual(result["final_equity"], 100000)
        with self.assertRaisesRegex(ValueError, "requires Binance"):
            Backtester(conf, self.bot.strategy).run(execution, now_ms=10 * DAY)
        with self.assertRaisesRegex(ValueError, "Missing signal"):
            Backtester(conf, self.bot.strategy).run(execution, now_ms=10 * DAY, signal_candles=signals[1:])
