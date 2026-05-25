import logging
import time

import schedule

from binance_client import get_daily_closes
from config import CHECK_INTERVAL_HOURS, RSI_ENABLED, RSI_BUY_THRESHOLD, RSI_SELL_THRESHOLD
from strategy import detect_signal, get_indicators
from upbit_client import MIN_ORDER_KRW, MIN_ORDER_BTC, buy_all_btc, sell_all_btc, validate_connection, get_balances

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

_prev_short_ma: float | None = None
_prev_long_ma: float | None = None


def initial_rebalance() -> None:
    """On startup, align position with the current MA trend."""
    global _prev_short_ma, _prev_long_ma

    log.info("Checking initial market state...")

    try:
        closes = get_daily_closes(limit=60)
    except Exception as exc:
        log.error("Failed to fetch klines for initial rebalance: %s", exc)
        return

    short_ma, long_ma, rsi = get_indicators(closes)
    _prev_short_ma = short_ma
    _prev_long_ma = long_ma

    if short_ma is None or long_ma is None:
        log.warning("Not enough data to determine initial state")
        return

    rsi_str = f"{rsi:.2f}" if rsi is not None else "N/A"
    trend = "GOLDEN CROSS" if short_ma > long_ma else "DEAD CROSS"
    log.info("Trend: %s  SMA5=%.2f  SMA20=%.2f  RSI=%s", trend, short_ma, long_ma, rsi_str)

    balances = get_balances()
    krw = balances.get("KRW", 0.0)
    btc = balances.get("BTC", 0.0)
    log.info("Account: KRW=%.0f원  BTC=%.8f", krw, btc)

    if short_ma > long_ma:  # Golden cross — should be holding BTC
        if krw >= MIN_ORDER_KRW:
            if RSI_ENABLED and rsi is not None and rsi >= RSI_BUY_THRESHOLD:
                log.info("Golden cross but RSI=%.2f >= %.0f — skipping initial buy", rsi, RSI_BUY_THRESHOLD)
            else:
                log.info("Golden cross with KRW balance — executing initial BUY")
                result, err = buy_all_btc()
                if err:
                    log.error("Initial BUY failed: %s", err)
                else:
                    log.info("Initial BUY executed: %s", result)
        else:
            log.info("Golden cross — already holding BTC, no action needed")

    else:  # Dead cross — should be holding KRW
        if btc >= MIN_ORDER_BTC:
            if RSI_ENABLED and rsi is not None and rsi < RSI_SELL_THRESHOLD:
                log.info("Dead cross but RSI=%.2f < %.0f — skipping initial sell", rsi, RSI_SELL_THRESHOLD)
            else:
                log.info("Dead cross with BTC balance — executing initial SELL")
                result, err = sell_all_btc()
                if err:
                    log.error("Initial SELL failed: %s", err)
                else:
                    log.info("Initial SELL executed: %s", result)
        else:
            log.info("Dead cross — already holding KRW, no action needed")


def run_strategy() -> None:
    global _prev_short_ma, _prev_long_ma

    log.info("Running strategy check...")

    try:
        closes = get_daily_closes(limit=60)
    except Exception as exc:
        log.error("Failed to fetch Binance klines: %s", exc)
        return

    signal, short_ma, long_ma, rsi = detect_signal(closes, _prev_short_ma, _prev_long_ma)

    rsi_str = f"{rsi:.2f}" if rsi is not None else "N/A"
    sma5_str = f"{short_ma:.2f}" if short_ma is not None else "N/A"
    sma20_str = f"{long_ma:.2f}" if long_ma is not None else "N/A"
    log.info("SMA5=%s  SMA20=%s  RSI=%s  Signal=%s", sma5_str, sma20_str, rsi_str, signal or "HOLD")

    if signal == "BUY":
        log.info("Golden cross detected — executing BUY order")
        result, err = buy_all_btc()
        if err:
            log.error("BUY failed: %s", err)
        else:
            log.info("BUY executed: %s", result)

    elif signal == "SELL":
        log.info("Dead cross detected — executing SELL order")
        result, err = sell_all_btc()
        if err:
            log.error("SELL failed: %s", err)
        else:
            log.info("SELL executed: %s", result)

    _prev_short_ma = short_ma
    _prev_long_ma = long_ma


if __name__ == "__main__":
    log.info("Bitcoin auto-trader starting (interval=%dh)", CHECK_INTERVAL_HOURS)

    try:
        validate_connection()
        log.info("Upbit API connection verified")
    except Exception as exc:
        log.critical("Upbit API validation failed: %s", exc)
        raise SystemExit(1)

    initial_rebalance()
    run_strategy()

    schedule.every(CHECK_INTERVAL_HOURS).hours.do(run_strategy)

    while True:
        schedule.run_pending()
        time.sleep(60)
