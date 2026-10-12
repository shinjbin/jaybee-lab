from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

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
                 f"시장: {bot.settings.symbol} / {bot.settings.interval}",
                 f"운영 모드: {'모의 매매' if bot.settings.dry_run else '실거래'}",
                 f"저장된 포지션: {state.position.value}",
                 f"미결 주문: {'있음' if state.pending_order else '없음'}"]
        try:
            exchange_now = bot.market.server_time()
            candles = bot.market.closed_candles(exchange_now)
            decision = bot.strategy.evaluate(candles, state.position)
            price = bot.market.execution_price()
            lines.extend(["시장 조회: 정상", f"현재가: {price:,.2f}",
                          f"최근 마감 가격: {decision.candle.close:,.2f}",
                          f"이동평균: {decision.sma:,.2f} / 상단 밴드: {decision.upper:,.2f}",
                          f"최근 마감봉 기준 신호: {decision.signal.value}"])
        except Exception as exc:
            # Never publish signed request URLs, API credentials, or raw error bodies.
            log.warning("STATUS_CHECK failed (%s)", type(exc).__name__)
            lines.append("시장 조회: 실패 — 최신 가격·신호 확인 불가")
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
