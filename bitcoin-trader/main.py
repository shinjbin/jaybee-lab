import logging
import time
from datetime import datetime, timezone, timedelta

import schedule

from binance_client import get_daily_closes
from config import CHECK_INTERVAL_HOURS, RSI_ENABLED, RSI_SELL_THRESHOLD
from strategy import detect_signal, get_indicators
from telegram_client import send
from upbit_client import MIN_ORDER_KRW, MIN_ORDER_BTC, buy_all_btc, sell_all_btc, validate_connection, get_balances

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

_prev_short_ma: float | None = None
_prev_long_ma: float | None = None


def _now_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")


def send_startup_status() -> None:
    try:
        closes = get_daily_closes(limit=60)
    except Exception as exc:
        log.error("Failed to fetch klines for startup status: %s", exc)
        send(f"🤖 <b>자동매매 봇 시작</b> — {_now_kst()}\n❌ 바이낸스 데이터 조회 실패: {exc}")
        return

    short_ma, long_ma, rsi = get_indicators(closes)
    rsi_str = f"{rsi:.2f}" if rsi is not None else "N/A"
    trend_icon = "🟢" if (short_ma and long_ma and short_ma > long_ma) else "🔴"
    trend_label = "골든크로스" if (short_ma and long_ma and short_ma > long_ma) else "데드크로스"
    sma5_str = f"{short_ma:,.2f}" if short_ma else "N/A"
    sma20_str = f"{long_ma:,.2f}" if long_ma else "N/A"

    send(
        f"🤖 <b>자동매매 봇 시작</b> — {_now_kst()}\n"
        f"현재가: ${closes[-1]:,.2f}\n"
        f"SMA5: ${sma5_str}  /  SMA20: ${sma20_str}\n"
        f"RSI: {rsi_str}\n"
        f"추세: {trend_icon} {trend_label}"
    )
    log.info("Startup status sent to Telegram")


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
            log.info("Golden cross with KRW balance — executing initial BUY")
            result, err = buy_all_btc()
            if err:
                log.error("Initial BUY failed: %s", err)
                send(f"❌ 초기 매수 실패: {err}")
            else:
                log.info("Initial BUY executed: %s", result)
                send(
                    f"🚀 <b>초기 매수 실행</b> — {_now_kst()}\n"
                    f"추세: 🟢 골든크로스\n"
                    f"SMA5: ${short_ma:,.2f} / SMA20: ${long_ma:,.2f}\n"
                    f"RSI: {rsi_str}\n"
                    f"KRW {krw:,.0f}원 전액 매수"
                )
        else:
            log.info("Golden cross — already holding BTC, no action needed")
            send(
                f"🤖 <b>자동매매 시작</b> — {_now_kst()}\n"
                f"추세: 🟢 골든크로스\n"
                f"이미 BTC 보유 중 (KRW: {krw:,.0f}원) — 포지션 유지"
            )

    else:  # Dead cross — should be holding KRW
        if btc >= MIN_ORDER_BTC:
            if RSI_ENABLED and rsi is not None and rsi < RSI_SELL_THRESHOLD:
                log.info("Dead cross but RSI=%.2f < %.0f — skipping initial sell", rsi, RSI_SELL_THRESHOLD)
                send(
                    f"🤖 <b>자동매매 시작</b> — {_now_kst()}\n"
                    f"추세: 🔴 데드크로스\n"
                    f"RSI {rsi:.2f} < {RSI_SELL_THRESHOLD:.0f} — RSI 과매도로 초기 매도 건너뜀"
                )
            else:
                log.info("Dead cross with BTC balance — executing initial SELL")
                result, err = sell_all_btc()
                if err:
                    log.error("Initial SELL failed: %s", err)
                    send(f"❌ 초기 매도 실패: {err}")
                else:
                    log.info("Initial SELL executed: %s", result)
                    send(
                        f"🔴 <b>초기 매도 실행</b> — {_now_kst()}\n"
                        f"추세: 🔴 데드크로스\n"
                        f"SMA5: ${short_ma:,.2f} / SMA20: ${long_ma:,.2f}\n"
                        f"RSI: {rsi_str}\n"
                        f"BTC {btc:.8f} 전액 매도"
                    )
        else:
            log.info("Dead cross — already holding KRW, no action needed")
            send(
                f"🤖 <b>자동매매 시작</b> — {_now_kst()}\n"
                f"추세: 🔴 데드크로스\n"
                f"이미 KRW 보유 중 (BTC: {btc:.8f}) — 포지션 유지"
            )


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

    trend_icon = "🟢" if (short_ma and long_ma and short_ma > long_ma) else "🔴"
    trend_label = "골든크로스" if (short_ma and long_ma and short_ma > long_ma) else "데드크로스"

    # 매시간 상태 요약 전송
    send(
        f"📊 <b>BTC 시간별 체크</b> — {_now_kst()}\n"
        f"현재가: ${closes[-1]:,.2f}\n"
        f"SMA5: ${sma5_str}  /  SMA20: ${sma20_str}\n"
        f"RSI: {rsi_str}\n"
        f"추세: {trend_icon} {trend_label}\n"
        f"신호: {'⚡ ' + signal if signal else '— HOLD'}"
    )

    if signal == "BUY":
        log.info("Golden cross detected — executing BUY order")
        result, err = buy_all_btc()
        if err:
            log.error("BUY failed: %s", err)
            send(f"❌ 매수 실패: {err}")
        else:
            log.info("BUY executed: %s", result)
            send(
                f"🚀 <b>골든크로스 매수 실행</b> — {_now_kst()}\n"
                f"SMA5: ${sma5_str} > SMA20: ${sma20_str}\n"
                f"RSI: {rsi_str}"
            )

    elif signal == "SELL":
        log.info("Dead cross detected — executing SELL order")
        result, err = sell_all_btc()
        if err:
            log.error("SELL failed: %s", err)
            send(f"❌ 매도 실패: {err}")
        else:
            log.info("SELL executed: %s", result)
            send(
                f"🔴 <b>데드크로스 매도 실행</b> — {_now_kst()}\n"
                f"SMA5: ${sma5_str} < SMA20: ${sma20_str}\n"
                f"RSI: {rsi_str}"
            )

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

    send_startup_status()
    initial_rebalance()
    run_strategy()

    schedule.every(CHECK_INTERVAL_HOURS).hours.do(run_strategy)

    while True:
        schedule.run_pending()
        time.sleep(60)
