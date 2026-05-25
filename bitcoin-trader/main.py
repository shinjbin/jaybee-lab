import logging
import time

import schedule

from binance_client import get_daily_closes
from config import CHECK_INTERVAL_HOURS
from strategy import detect_signal
from upbit_client import buy_all_btc, sell_all_btc, validate_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

_prev_short_ma: float | None = None
_prev_long_ma: float | None = None


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

    run_strategy()

    schedule.every(CHECK_INTERVAL_HOURS).hours.do(run_strategy)

    while True:
        schedule.run_pending()
        time.sleep(60)
