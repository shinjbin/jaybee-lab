from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum


class Position(str, Enum):
    CASH = "CASH"
    LONG = "LONG"


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass(frozen=True)
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time: int

    def __post_init__(self):
        if not all(math.isfinite(x) and x > 0 for x in (self.open, self.high, self.low, self.close)):
            raise ValueError("Invalid candle prices")
        if not math.isfinite(self.volume) or self.volume < 0 or self.open_time > self.close_time:
            raise ValueError("Invalid candle volume/timestamps")
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close):
            raise ValueError("Invalid candle OHLC range")

    @classmethod
    def from_kline(cls, row) -> Candle:
        return cls(int(row[0]), *(float(row[i]) for i in range(1, 6)), int(row[6]))


@dataclass(frozen=True)
class Decision:
    signal: Signal
    candle: Candle
    sma: float
    std: float
    upper: float
    previous_close: float
    previous_upper: float


@dataclass
class BotState:
    position: Position = Position.CASH
    cash: Decimal = Decimal("0")
    quantity: Decimal = Decimal("0")
    last_processed_open_time: int | None = None
    last_order_id: str | None = None
    last_entry_price: Decimal | None = None
    pending_order: dict | None = None

    @classmethod
    def from_dict(cls, data):
        data = dict(data)
        data["position"] = Position(data["position"])
        for key in ("cash", "quantity", "last_entry_price"):
            if data.get(key) is not None:
                data[key] = Decimal(str(data[key]))
        return cls(**data)
