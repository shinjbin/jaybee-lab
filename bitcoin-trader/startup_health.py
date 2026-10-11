from __future__ import annotations

import hashlib
import logging
import math
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from binance_client import BinanceClient, BinanceError, BinanceMarketDataClient
from config import Settings, boolean
from models import BotState
from state_repository import BotBusy, StateRepository, encode
from telegram_client import send
from upbit_client import UpbitError, UpbitHealthClient

log = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))


@dataclass(frozen=True)
class StartupSettings:
    enabled: bool = True
    upbit_base_url: str = "https://api.upbit.com"
    upbit_access_key: str = field(default="", repr=False)
    upbit_secret_key: str = field(default="", repr=False)
    telegram_token: str = field(default="", repr=False)
    telegram_chat_id: str = ""
    pod_name: str = "local"
    version: str = "local"
    notification_cooldown: float = 3600
    notification_state_path: str = "data/startup-health.sqlite3"

    def __post_init__(self):
        if not math.isfinite(self.notification_cooldown) or self.notification_cooldown < 0:
            raise ValueError("Startup notification cooldown must be finite and >= 0")

    @classmethod
    def from_env(cls, settings: Settings):
        return cls(enabled=boolean(os.getenv("STARTUP_HEALTH_ENABLED", "true")),
            upbit_base_url=os.getenv("UPBIT_BASE_URL", "https://api.upbit.com"),
            upbit_access_key=os.getenv("UPBIT_ACCESS_KEY", ""), upbit_secret_key=os.getenv("UPBIT_SECRET_KEY", ""),
            telegram_token=os.getenv("TELEGRAM_BOT_TOKEN", ""), telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", ""),
            pod_name=os.getenv("POD_NAME", os.getenv("HOSTNAME", "local")), version=os.getenv("BUILD_VERSION", "local"),
            notification_cooldown=float(os.getenv("STARTUP_NOTIFICATION_COOLDOWN_SECONDS", "3600")),
            notification_state_path=os.getenv("STARTUP_HEALTH_STATE_PATH",
                str(Path(settings.state_path).parent / "startup-health.sqlite3")))


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: str
    detail: str
    required: bool = False


@dataclass(frozen=True)
class HealthReport:
    results: list[CheckResult]
    dry_run: bool
    pod_name: str
    version: str
    started_at: str
    symbol: str = "BTCUSDT"
    interval: str = "1d"

    @property
    def ready(self):
        return all(r.status == "ok" for r in self.results if r.required)

    def message(self):
        icons = {"ok": "✅", "failed": "❌", "unconfigured": "⚠️"}
        action = "가상 매매 시작 가능" if self.dry_run else "실거래 시작 가능"
        if not self.ready:
            action = "Binance 필수 점검 실패: 매매 시작 차단"
        return "\n".join(["🔎 비트코인 봇 배포·시작 API 점검", self.started_at,
            f"Pod: {self.pod_name}", f"Version: {self.version[:40]}", f"DRY_RUN: {str(self.dry_run).lower()}",
            f"Market: {self.symbol} / {self.interval}",
            *(f"{icons[r.status]} {r.name}: {r.detail}" for r in self.results),
            action, "연결 점검은 조회 API만 사용하며 주문을 보내지 않습니다."])

    def fingerprint(self):
        # Ignore timestamps/Pod replacement names; status changes notify independently.
        identity = {"version": self.version, "dry_run": self.dry_run, "symbol": self.symbol, "interval": self.interval,
                    "results": [asdict(r) for r in self.results]}
        return hashlib.sha256(encode(identity).encode()).hexdigest()


def error_detail(exc):
    if isinstance(exc, BinanceError):
        known = {-2015: "API 키·허용 IP·권한 확인 필요", -1021: "서버 시간 차이 확인 필요",
                 -1022: "서명 인증 실패", -1007: "응답 시간 초과", -1121: "심볼 확인 필요"}
        reason = known.get(exc.code, "인증·연결 또는 응답 확인 실패")
        if exc.status in (418, 429):
            reason = "요청 제한: Retry-After 후 재시도"
        return f"HTTP {exc.status}: {reason}" if exc.status else reason
    if isinstance(exc, UpbitError):
        return f"HTTP {exc.status}: {exc.reason}"
    if isinstance(exc, requests.Timeout):
        return "응답 시간 초과"
    if isinstance(exc, requests.ConnectionError):
        return "네트워크 연결 실패"
    # Never echo raw exception bodies, bearer tokens, signed URLs, or balances.
    return "인증·연결 또는 응답 확인 실패"


class StartupHealth:
    def __init__(self, settings: Settings, startup: StartupSettings, dry_run: bool,
                 binance=None, upbit=None):
        self.settings, self.startup, self.dry_run = settings, startup, dry_run
        self.binance = binance or BinanceClient(settings)
        self.market = BinanceMarketDataClient(self.binance)
        self.upbit = upbit or UpbitHealthClient(startup.upbit_base_url, startup.upbit_access_key,
            startup.upbit_secret_key, settings.timeout_seconds)

    def check(self):
        def market_probe():
            candles = self.market.closed_candles(self.market.server_time())
            if len(candles) < self.settings.bollinger_period + 1:
                raise ValueError("Insufficient completed history")

        def account_probe():
            # Sync the signing clock independently, even if a different probe failed.
            self.binance.server_time()
            account = self.binance.account()
            if not isinstance(account.get("balances"), list) or not isinstance(account.get("canTrade"), bool):
                raise ValueError("Invalid account response")
            if not self.dry_run and not account["canTrade"]:
                return CheckResult("Binance 계좌 인증", "failed", "계좌 조회 정상, 거래 권한 없음", True)
            detail = "계좌 조회·인증 정상" if account["canTrade"] else "계좌 조회·인증 정상 (거래 권한 없음)"
            return CheckResult("Binance 계좌 인증", "ok", detail, not self.dry_run)

        probes = [
            ("Binance 서버 시간", True, True, self.binance.server_time),
            ("Binance 현물 심볼", True, True, self.binance.symbol_info),
            ("Binance 마감 일봉", True, True, market_probe),
            ("Binance 계좌 인증", bool(self.settings.api_key and self.settings.api_secret), not self.dry_run, account_probe),
            ("Upbit 계좌 인증", bool(self.startup.upbit_access_key and self.startup.upbit_secret_key), False, self.upbit.check_account),
        ]
        results = []
        for name, configured, required, probe in probes:
            if not configured:
                results.append(CheckResult(name, "unconfigured", "API 키 미설정: 인증 확인 불가", required))
                continue
            try:
                result = probe()
                results.append(result if isinstance(result, CheckResult) else CheckResult(name, "ok", "연결 정상", required))
            except Exception as exc:
                results.append(CheckResult(name, "failed", error_detail(exc), required))
        return HealthReport(results, self.dry_run, self.startup.pod_name, self.startup.version,
                            datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"), self.settings.symbol, self.settings.interval)


class StartupNotifier:
    def __init__(self, startup: StartupSettings, sender=send, repository=None, clock=time.time):
        self.startup, self.sender, self.clock = startup, sender, clock
        self.repository = repository

    def receipt_key(self, report):
        # Scope receipts to the recipient and market without storing credentials in keys.
        target = {"token": self.startup.telegram_token, "chat": self.startup.telegram_chat_id,
                  "symbol": report.symbol, "interval": report.interval}
        return "startup-" + hashlib.sha256(encode(target).encode()).hexdigest()

    def notify(self, report: HealthReport):
        log.info("STARTUP_HEALTH %s", report.message())
        if not self.startup.telegram_token or not self.startup.telegram_chat_id:
            log.warning("Startup Telegram notification skipped: token/chat ID missing")
            return "unconfigured"
        try:
            repository = self.repository or StateRepository(self.startup.notification_state_path,
                "startup-health-notifications", BotState())
            with repository.lock():
                key, now = self.receipt_key(report), self.clock()
                last = repository.notification(key)
                fingerprint = report.fingerprint()
                if (last and last["payload"].get("fingerprint") == fingerprint
                        and now - last["attempted_at"] < self.startup.notification_cooldown):
                    log.info("Startup Telegram notification suppressed during cooldown (previous delivered=%s)", last["delivered"])
                    return "suppressed"
                payload = {"type": "STARTUP_HEALTH", "report": asdict(report), "fingerprint": fingerprint}
                # Durable reservation also limits duplicates if Telegram timed out after delivery.
                repository.save_notification(key, now, False, payload)
                delivered = self.sender(report.message(), token=self.startup.telegram_token,
                    chat_id=self.startup.telegram_chat_id)
                repository.save_notification(key, now, delivered is True, payload)
                return "delivered" if delivered is True else "failed"
        except BotBusy:
            log.info("Another process is sending the startup notification")
            return "suppressed"
        except Exception:
            log.error("Startup Telegram notification or receipt persistence failed")
            return "failed"
