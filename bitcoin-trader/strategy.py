from config import SHORT_MA, LONG_MA, RSI_PERIOD, RSI_ENABLED, RSI_BUY_THRESHOLD, RSI_SELL_THRESHOLD


def _sma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _rsi(closes: list[float], period: int) -> float | None:
    """Wilder's smoothed RSI."""
    if len(closes) < period + 1:
        return None

    deltas = [closes[i + 1] - closes[i] for i in range(len(closes) - 1)]
    gains = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1 + rs))


def detect_signal(
    closes: list[float],
    prev_short_ma: float | None,
    prev_long_ma: float | None,
) -> tuple[str | None, float | None, float | None, float | None]:
    """
    Returns (signal, short_ma, long_ma, rsi).
    signal is 'BUY', 'SELL', or None.
    """
    short_ma = _sma(closes, SHORT_MA)
    long_ma = _sma(closes, LONG_MA)
    rsi = _rsi(closes, RSI_PERIOD)

    if short_ma is None or long_ma is None or prev_short_ma is None or prev_long_ma is None:
        return None, short_ma, long_ma, rsi

    signal = None

    # Golden cross: short MA crosses above long MA
    if prev_short_ma <= prev_long_ma and short_ma > long_ma:
        signal = "BUY"
        if RSI_ENABLED and rsi is not None and rsi >= RSI_BUY_THRESHOLD:
            signal = None  # RSI overbought, skip

    # Dead cross: short MA crosses below long MA
    elif prev_short_ma >= prev_long_ma and short_ma < long_ma:
        signal = "SELL"
        if RSI_ENABLED and rsi is not None and rsi < RSI_SELL_THRESHOLD:
            signal = None  # RSI oversold, skip

    return signal, short_ma, long_ma, rsi
