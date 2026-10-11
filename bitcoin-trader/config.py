from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

INTERVAL_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000,
               "4h": 14_400_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000}


def boolean(value: str) -> bool:
    if value.lower() not in {"true", "false"}:
        raise ValueError("Boolean settings must be true or false")
    return value.lower() == "true"


@dataclass(frozen=True)
class Settings:
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    bollinger_period: int = 49
    bollinger_stddev: float = 1.8
    fee_rate: float = 0.001
    slippage_rate: float = 0.0005
    position_size: float = 1.0  # Fraction of available quote balance; SELL always exits all.
    dry_run: bool = True
    initial_cash: float = 10_000.0
    history_limit: int = 200
    poll_seconds: float = 5.0
    timeout_seconds: float = 10.0
    read_retries: int = 3
    base_url: str = "https://api.binance.com"
    api_key: str = field(default="", repr=False)
    api_secret: str = field(default="", repr=False)
    state_path: str = "data/dry-run.sqlite3"

    def __post_init__(self):
        numbers = (self.bollinger_stddev, self.fee_rate, self.slippage_rate,
                   self.position_size, self.initial_cash, self.poll_seconds, self.timeout_seconds)
        if not all(math.isfinite(x) for x in numbers):
            raise ValueError("Settings must be finite numbers")
        if not self.symbol or self.interval not in INTERVAL_MS:
            raise ValueError("Invalid symbol or unsupported fixed-duration interval")
        if self.bollinger_period < 2 or self.bollinger_stddev <= 0:
            raise ValueError("Bollinger period must be >= 2 and multiplier > 0")
        if not self.bollinger_period + 2 <= self.history_limit <= 1000:
            raise ValueError("History limit must cover both bands plus an open candle (<=1000)")
        if not 0 <= self.fee_rate < 1 or not 0 <= self.slippage_rate < 1:
            raise ValueError("Fee/slippage must be in [0, 1)")
        if not 0 < self.position_size <= 1 or self.initial_cash <= 0:
            raise ValueError("Position size must be in (0, 1] and initial cash > 0")
        if self.poll_seconds <= 0 or self.timeout_seconds <= 0 or self.read_retries < 1:
            raise ValueError("Polling, timeout, and read retries must be positive")
        if not self.dry_run and not (self.api_key and self.api_secret):
            raise ValueError("Live mode requires BINANCE_API_KEY and BINANCE_API_SECRET")

    @classmethod
    def from_env(cls, *, dry_run: bool | None = None) -> Settings:
        dry = boolean(os.getenv("DRY_RUN", "true")) if dry_run is None else dry_run
        return cls(
            symbol=os.getenv("BINANCE_SYMBOL", "BTCUSDT"),
            interval=os.getenv("BINANCE_INTERVAL", "1d"),
            bollinger_period=int(os.getenv("BOLLINGER_PERIOD", "49")),
            bollinger_stddev=float(os.getenv("BOLLINGER_STDDEV", "1.8")),
            fee_rate=float(os.getenv("FEE_RATE", "0.001")),
            slippage_rate=float(os.getenv("SLIPPAGE_RATE", "0.0005")),
            position_size=float(os.getenv("POSITION_SIZE", "1")), dry_run=dry,
            initial_cash=float(os.getenv("INITIAL_CASH", "10000")),
            history_limit=int(os.getenv("HISTORY_LIMIT", "200")),
            poll_seconds=float(os.getenv("POLL_SECONDS", "5")),
            timeout_seconds=float(os.getenv("API_TIMEOUT_SECONDS", "10")),
            read_retries=int(os.getenv("READ_RETRIES", "3")),
            base_url=os.getenv("BINANCE_BASE_URL", "https://api.binance.com").rstrip("/"),
            api_key=os.getenv("BINANCE_API_KEY", ""), api_secret=os.getenv("BINANCE_API_SECRET", ""),
            state_path=os.getenv("STATE_PATH", os.path.join(os.getenv("TRADER_DATA_DIR", "data"),
                f"{'dry-run' if dry else 'live'}.sqlite3")),
        )


TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
