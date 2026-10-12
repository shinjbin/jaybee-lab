from __future__ import annotations

import argparse
import logging
import os
import signal
import threading

from binance_client import BinanceClient, BinanceError, BinanceMarketDataClient
from config import Settings, boolean
from models import BotState
from order_executor import BinanceOrderExecutor, D, SimulatedOrderExecutor
from periodic_status import PeriodicStatus
from state_repository import BotBusy, StateRepository, encode
from startup_health import StartupHealth, StartupNotifier, StartupSettings
from strategy import BollingerBreakoutStrategy
from trading_bot import TradingBot

log = logging.getLogger(__name__)


def build_bot(settings):
    client = BinanceClient(settings)
    repository = StateRepository(settings.state_path,
        f"{settings.base_url}:{settings.symbol}:{settings.interval}:{'dry' if settings.dry_run else 'live'}",
        BotState(cash=D(settings.initial_cash) if settings.dry_run else D(0)))
    executor = SimulatedOrderExecutor(settings) if settings.dry_run else BinanceOrderExecutor(client)
    return TradingBot(settings, BinanceMarketDataClient(client),
        BollingerBreakoutStrategy(settings.bollinger_period, settings.bollinger_stddev), executor, repository)


def main():
    parser = argparse.ArgumentParser(description="Binance Spot Bollinger breakout bot")
    parser.add_argument("--once", action="store_true", help="Process latest completed candle once")
    parser.add_argument("--export-log", choices=("decisions", "trades", "events"), help="Print durable JSONL records")
    parser.add_argument("--check-connections", action="store_true", help="Check exchange APIs, notify Telegram, and exit without trading")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    if args.export_log:
        settings = Settings.from_env()
        bot = build_bot(settings)
        for record in bot.repository.records(args.export_log):
            print(encode(record))
        return
    # Check missing/invalid live credentials and notify BEFORE live settings reject them.
    probe_settings = Settings.from_env(dry_run=True)
    startup = StartupSettings.from_env(probe_settings)
    if startup.enabled or args.check_connections:
        report = StartupHealth(probe_settings, startup, boolean(os.getenv("DRY_RUN", "true"))).check()
        notification = StartupNotifier(startup).notify(report)
        log.info("Startup notification result: %s", notification)
        if not report.ready or (args.check_connections and any(r.status == "failed" for r in report.results)):
            log.error("Startup connection checks failed")
            raise SystemExit(1)
        if args.check_connections:
            return
    settings = Settings.from_env()
    bot = build_bot(settings)
    status = PeriodicStatus(bot)
    log.info("Starting %s %s Bollinger period=%s stddev=%s dry_run=%s state=%s",
        settings.symbol, settings.interval, settings.bollinger_period, settings.bollinger_stddev,
        settings.dry_run, settings.state_path)
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    while not stopped.is_set():
        delay = settings.poll_seconds
        try:
            bot.run_once()
        except BotBusy:
            log.info("Another process is handling this repository")
        except BinanceError as exc:
            log.error("Exchange request failed: %s", exc)
            delay = max(delay, exc.retry_after)
            if args.once:
                raise SystemExit(1) from None
        except Exception as exc:
            # Avoid traceback of signed request objects; persisted intent survives all failures.
            log.error("Trading check failed (%s): %s", type(exc).__name__, exc)
            if args.once:
                raise SystemExit(1) from None
        try:
            status.tick()
        except BotBusy:
            log.info("Another process is checking status")
        except Exception as exc:
            log.error("Periodic status check failed (%s)", type(exc).__name__)
        if args.once:
            return
        stopped.wait(delay)


if __name__ == "__main__":
    main()
