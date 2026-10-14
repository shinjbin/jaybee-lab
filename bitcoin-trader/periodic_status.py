from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from models import Signal
from telegram_client import send

log = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")


@dataclass(frozen=True)
class StatusSettings:
    check_seconds: float = 3600
    report_seconds: float = 21600

    def __post_init__(self):
        if not all(math.isfinite(x) and x > 0 for x in (self.check_seconds, self.report_seconds)):
            raise ValueError("Status check/report intervals must be finite and positive")

    @classmethod
    def from_env(cls):
        return cls(float(os.getenv("STATUS_CHECK_SECONDS", "3600")),
                   float(os.getenv("STATUS_REPORT_SECONDS", "21600")))


class PeriodicStatus:
    """Read-only status checks; durable delivery timing survives Pod restarts."""

    def __init__(self, bot, settings=None, *, sender=send, clock=time.time):
        self.bot = bot
        self.settings = settings or StatusSettings.from_env()
        self.sender, self.clock = sender, clock

    def _snapshot(self, now):
        bot = self.bot
        state = bot.repository.load()
        lines = ["비트코인 현재 상태", datetime.fromtimestamp(now, KST).strftime("%Y-%m-%d %H:%M:%S KST"),
                 f"거래소: {bot.settings.exchange.upper()}",
                 f"주문 시장: {bot.settings.symbol} / {bot.settings.interval}",
                 f"신호 기준: BINANCE {bot.settings.signal_market_symbol} / {bot.settings.interval}",
                 f"운영 모드: {'모의 매매' if bot.settings.dry_run else '실거래'}",
                 f"실제 주문 전송: {'비활성 (모의 체결만 수행)' if bot.settings.dry_run else '활성 (주문 조건·계좌 검증 통과 시)'}",
                 f"저장된 포지션: {state.position.value}",
                 f"미결 주문: {'있음' if state.pending_order else '없음'}"]
        trade = bot.repository.latest_trade()
        if trade:
            side = '매수' if trade['side'] == Signal.BUY.value else '매도'
            mode = '모의' if trade['dry_run'] else '실거래'
            executed_at = trade.get('execution_time')
            timestamp = (datetime.fromtimestamp(executed_at / 1000, KST).strftime('%Y-%m-%d %H:%M:%S KST')
                         if executed_at is not None else '시각 확인 불가')
            lines.append(f"최근 체결: {mode} {side} / {timestamp}")
        else:
            lines.append("최근 체결: 없음 (현재 운영 모드의 저장 이력 기준)")
        try:
            exchange_now = bot.market.server_time()
            candles = bot.market.closed_candles(exchange_now)
            decision = bot.strategy.evaluate(candles, state.position)
            price = bot.market.execution_price()
            lines.extend(["시장 조회: 정상", f"주문 시장 현재가 ({bot.settings.symbol}): {price:,.2f}",
                          f"Binance 최근 마감 가격 ({bot.settings.signal_market_symbol}, USDT): {decision.candle.close:,.2f}",
                          f"Binance 이동평균: {decision.sma:,.2f} / 상단 밴드: {decision.upper:,.2f} USDT",
                          f"최근 마감봉 기준 신호: {decision.signal.value}",
                          f"매수 신호: {'있음' if decision.signal == Signal.BUY else '없음'}",
                          f"매도 신호: {'있음' if decision.signal == Signal.SELL else '없음'}"])
            processed = (state.last_processed_open_time is not None
                         and decision.candle.open_time <= state.last_processed_open_time)
            if state.pending_order:
                lines.append("신규 주문: 대기 (미결 주문 확인 중)")
            elif processed:
                lines.append("신규 주문: 없음 (최근 마감봉 처리 완료)")
            else:
                lines.append("신규 주문: 매매 루프에서 신호·잔고·주문 조건 확인 후 결정")
        except Exception as exc:
            # Never publish signed request URLs, API credentials, or raw error bodies.
            log.warning("STATUS_CHECK failed (%s)", type(exc).__name__)
            lines.append("시장 조회: 실패 — 최신 가격·신호 확인 불가")
            lines.extend(["매수 신호: 확인 불가", "매도 신호: 확인 불가"])
        return "\n".join(lines)

    def tick(self):
        repository = self.bot.repository
        with repository.lock():
            now = self.clock()
            check = repository.notification("periodic-status-check")
            receipt = repository.notification("periodic-status-report")
            delivered_at = receipt["payload"].get("delivered_at") if receipt else None
            due = delivered_at is None or now - delivered_at >= self.settings.report_seconds
            retry_due = receipt is None or now - receipt["attempted_at"] >= self.settings.check_seconds
            if check is None or now - check["attempted_at"] >= self.settings.check_seconds or (due and retry_due):
                message = self._snapshot(now)
                repository.save_notification("periodic-status-check", now, True, {"message": message})
                log.info("STATUS_CHECK %s", message)
            else:
                message = check["payload"]["message"]
            if not due or not retry_due:
                return "suppressed"
            payload = {"delivered_at": delivered_at}
            # Reserve before sending so a crash/timeout cannot cause restart spam.
            repository.save_notification("periodic-status-report", now, False, payload)
            try:
                delivered = self.sender(message) is True
            except Exception:
                delivered = False
            if delivered:
                payload["delivered_at"] = now
            repository.save_notification("periodic-status-report", now, delivered, payload)
            log.info("STATUS_REPORT %s", "delivered" if delivered else "failed; retry at next status check")
            return "delivered" if delivered else "failed"
