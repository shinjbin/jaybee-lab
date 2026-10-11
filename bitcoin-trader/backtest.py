from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from binance_client import BinanceClient, BinanceMarketDataClient, validate_candles
from config import INTERVAL_MS, Settings
from models import BotState, Candle, Signal
from order_executor import D, SimulatedOrderExecutor
from state_repository import encode
from strategy import BollingerBreakoutStrategy, Strategy


class Backtester:
    def __init__(self, settings: Settings, strategy: Strategy):
        self.settings, self.strategy = settings, strategy
        self.executor = SimulatedOrderExecutor(settings)

    def run(self, candles, start_ms=None, end_ms=None, now_ms=None):
        cutoff = now_ms if now_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
        # An unfinished last row is excluded from both signals and executions.
        candles = [c for c in candles if c.close_time < cutoff]
        validate_candles(candles, INTERVAL_MS[self.settings.interval])
        state = BotState(cash=D(self.settings.initial_cash))
        trades, curve, decisions = [], [], []
        pending = None
        for i, candle in enumerate(candles):
            if start_ms is not None and candle.open_time < start_ms:
                continue  # Earlier history only warms indicators; validation starts in CASH.
            if end_ms is not None and candle.open_time >= end_ms:
                break
            if pending is not None:
                # Only at next open: never use the signal candle's close as execution.
                intent = self.executor.prepare(pending.signal, state, candle.open, pending.candle.open_time)
                trades.append(self.executor.fill(intent, state, candle.open_time))
                pending = None
            if i + 1 >= self.strategy.required_candles:
                decision = self.strategy.evaluate(candles[max(0, i + 1 - self.strategy.required_candles):i + 1], state.position)
                decisions.append({"candle": candle.open_time, "signal": decision.signal.value,
                                  "position": state.position.value, "sma": decision.sma,
                                  "std": decision.std, "upper_band": decision.upper})
                if decision.signal != Signal.HOLD:
                    pending = decision
            curve.append({"open_time": candle.open_time, "equity": float(state.cash + state.quantity * D(candle.close))})
        if not curve:
            raise ValueError("No completed candles in selected backtest range")
        peak = self.settings.initial_cash
        mdd = 0.0
        for point in curve:
            peak = max(peak, point["equity"])
            mdd = max(mdd, 1 - point["equity"] / peak)
        final = curve[-1]["equity"]
        return {"initial_cash": self.settings.initial_cash, "final_equity": final,
                "return_pct": (final / self.settings.initial_cash - 1) * 100, "mdd_pct": mdd * 100,
                "mdd_basis": "completed candle close equity", "trade_count": len(trades),
                "position": state.position.value, "cash": str(state.cash), "quantity": str(state.quantity),
                "unexecuted_signal": pending.signal.value if pending else None,
                "settings": {k: getattr(self.settings, k) for k in ("symbol", "interval", "bollinger_period",
                    "bollinger_stddev", "fee_rate", "slippage_rate", "position_size")},
                "trades": trades, "equity_curve": curve, "decisions": decisions}


def timestamp(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def load_candles(path):
    path = Path(path)
    if path.suffix.lower() == ".csv":
        with path.open() as handle:
            rows = list(csv.DictReader(handle))
    else:
        rows = json.loads(path.read_text())
    result = []
    for row in rows:
        if isinstance(row, list):
            result.append(Candle.from_kline(row))
        else:
            result.append(Candle(int(row.get("open_time", row.get("openTime"))),
                *(float(row[k]) for k in ("open", "high", "low", "close", "volume")),
                int(row.get("close_time", row.get("closeTime")))))
    return result


def main():
    parser = argparse.ArgumentParser(description="Shared-strategy next-open Binance Spot backtest")
    parser.add_argument("--candles", help="CSV or JSON candles (chronological, millisecond timestamps)")
    parser.add_argument("--download", help="Save Binance history to JSON; requires --start and --end")
    parser.add_argument("--start", help="Inclusive UTC date; earlier input candles warm indicators")
    parser.add_argument("--end", help="Exclusive UTC date")
    parser.add_argument("--output", default="backtest-result.json")
    args = parser.parse_args()
    # Backtest always uses public data and virtual accounting, regardless of live env flags.
    settings = Settings.from_env(dry_run=True)
    strategy = BollingerBreakoutStrategy(settings.bollinger_period, settings.bollinger_stddev)
    start, end = timestamp(args.start) if args.start else None, timestamp(args.end) if args.end else None
    if start is not None and end is not None and end <= start:
        parser.error("--end must be after --start")
    if args.download:
        if start is None or end is None:
            parser.error("--download requires --start and --end")
        market = BinanceMarketDataClient(BinanceClient(settings))
        candles = market.history(start - strategy.required_candles * INTERVAL_MS[settings.interval], end)
        Path(args.download).write_text(encode([asdict(c) for c in candles]) + "\n")
    elif args.candles:
        candles = load_candles(args.candles)
    else:
        parser.error("Provide --candles or --download")
    result = Backtester(settings, strategy).run(candles, start, end)
    Path(args.output).write_text(encode(result) + "\n")
    print(encode({k: v for k, v in result.items() if k not in {"trades", "equity_curve", "decisions"}}))


if __name__ == "__main__":
    main()
