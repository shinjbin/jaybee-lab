from __future__ import annotations

from abc import ABC, abstractmethod
from statistics import fmean, pstdev
from typing import Sequence

from models import Candle, Decision, Position, Signal


class Strategy(ABC):
    @property
    @abstractmethod
    def required_candles(self) -> int: ...

    @abstractmethod
    def evaluate(self, candles: Sequence[Candle], position: Position) -> Decision: ...


class BollingerBreakoutStrategy(Strategy):
    def __init__(self, period: int, stddev: float):
        if period < 2 or stddev <= 0:
            raise ValueError("Invalid Bollinger parameters")
        self.period, self.multiplier = period, stddev

    @property
    def required_candles(self) -> int:
        return self.period + 1

    def _bands(self, closes):
        middle, std = fmean(closes), pstdev(closes)  # Population STD (ddof=0).
        return middle, std, middle + self.multiplier * std

    def evaluate(self, candles: Sequence[Candle], position: Position) -> Decision:
        """Caller supplies only completed candles, in chronological order."""
        if len(candles) < self.required_candles:
            raise ValueError("Insufficient candles for both previous and current bands")
        window = candles[-self.required_candles:]
        if any(a.open_time >= b.open_time or a.close_time >= b.open_time
               for a, b in zip(window, window[1:])):
            raise ValueError("Candles must be strictly chronological and non-overlapping")
        closes = [c.close for c in window]
        sma, std, upper = self._bands(closes[1:])
        previous_upper = self._bands(closes[:-1])[2]
        signal = Signal.HOLD
        if position == Position.CASH and closes[-2] <= previous_upper and closes[-1] > upper:
            signal = Signal.BUY
        elif position == Position.LONG and closes[-1] < sma:
            signal = Signal.SELL
        return Decision(signal, window[-1], sma, std, upper, closes[-2], previous_upper)
