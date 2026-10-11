from __future__ import annotations

import hashlib
import hmac
import time
from typing import Protocol
from urllib.parse import urlencode

import requests

from config import INTERVAL_MS, Settings
from models import Candle


class BinanceError(RuntimeError):
    def __init__(self, code=None, status=None, retry_after=0, uncertain=False):
        # Never include signed URLs, credentials, or requests exceptions in logs.
        super().__init__(f"Binance error code={code} HTTP={status} uncertain={uncertain}")
        self.code, self.status = code, status
        self.retry_after, self.uncertain = retry_after, uncertain


class BinanceClient:
    def __init__(self, settings: Settings, session=None, sleep=time.sleep):
        self.settings = settings
        self.session = session or requests.Session()
        self.sleep = sleep
        self.offset_ms = 0
        self.blocked_until = 0.0

    def request(self, method, path, params=None, signed=False):
        if signed and not (self.settings.api_key and self.settings.api_secret):
            raise ValueError("Authenticated Binance request requires credentials")
        attempts = self.settings.read_retries if method == "GET" else 1
        for attempt in range(attempts):
            remaining = self.blocked_until - time.monotonic()
            if remaining > 0:
                raise BinanceError(status=429, retry_after=remaining)
            query = dict(params or {})
            headers = {}
            if signed:
                query.update(timestamp=int(time.time() * 1000) + self.offset_ms, recvWindow=5000)
                query["signature"] = hmac.new(self.settings.api_secret.encode(),
                    urlencode(query).encode(), hashlib.sha256).hexdigest()
                headers["X-MBX-APIKEY"] = self.settings.api_key
            try:
                response = self.session.request(method, self.settings.base_url + path,
                    params=query, headers=headers, timeout=self.settings.timeout_seconds)
                try:
                    data = response.json()
                except ValueError:
                    data = {}
                code = data.get("code") if isinstance(data, dict) else None
                if response.status_code >= 400 or (code is not None and code < 0):
                    retry_after = float(response.headers.get("Retry-After", "60")) if response.status_code in (418, 429) else 0
                    if retry_after:
                        self.blocked_until = time.monotonic() + retry_after
                    error = BinanceError(code, response.status_code, retry_after,
                        uncertain=response.status_code >= 500 or code in (-1000, -1001, -1006, -1007, -1008))
                    retryable = response.status_code >= 500 or code in (-1000, -1001, -1006, -1007, -1008)
                    if method == "GET" and retryable and attempt + 1 < attempts:
                        self.sleep(2 ** attempt)
                        continue
                    raise error
                if not data:
                    # [] is valid for no open orders / no fills.
                    if data == []:
                        return data
                    raise BinanceError(status=response.status_code, uncertain=method != "GET")
                return data
            except requests.RequestException:
                if method == "GET" and attempt + 1 < attempts:
                    self.sleep(2 ** attempt)
                    continue
                raise BinanceError(uncertain=method != "GET") from None

    def server_time(self):
        before = int(time.time() * 1000)
        result = int(self.request("GET", "/api/v3/time")["serverTime"])
        after = int(time.time() * 1000)
        self.offset_ms = result - (before + after) // 2
        return result

    def account(self):
        return self.request("GET", "/api/v3/account", signed=True)

    def symbol_info(self):
        response = self.request("GET", "/api/v3/exchangeInfo", {"symbol": self.settings.symbol})
        info = response["symbols"][0]
        if info["symbol"] != self.settings.symbol or info["status"] != "TRADING" or not info.get("isSpotTradingAllowed"):
            raise ValueError("Symbol is unavailable for Spot trading")
        if "MARKET" not in info["orderTypes"] or not info.get("quoteOrderQtyMarketAllowed"):
            raise ValueError("Symbol does not support quote-sized market orders")
        return info

    def open_orders(self):
        return self.request("GET", "/api/v3/openOrders", {"symbol": self.settings.symbol}, signed=True)

    def submit_order(self, params):
        # Deliberately no POST retries, even when client ID is deterministic.
        return self.request("POST", "/api/v3/order", params, signed=True)

    def query_order(self, client_id):
        return self.request("GET", "/api/v3/order",
            {"symbol": self.settings.symbol, "origClientOrderId": client_id}, signed=True)

    def order_trades(self, order_id):
        return self.request("GET", "/api/v3/myTrades",
            {"symbol": self.settings.symbol, "orderId": order_id, "limit": 1000}, signed=True)


class MarketDataClient(Protocol):
    def server_time(self) -> int: ...
    def closed_candles(self, now_ms: int) -> list[Candle]: ...
    def execution_price(self) -> float: ...


def validate_candles(candles, interval_ms):
    if any(c.close_time != c.open_time + interval_ms - 1 for c in candles):
        raise ValueError("Unexpected candle duration")
    if any(b.open_time != a.open_time + interval_ms for a, b in zip(candles, candles[1:])):
        raise ValueError("Missing, duplicate, or unordered candles")


class BinanceMarketDataClient:
    def __init__(self, client: BinanceClient):
        self.client, self.settings = client, client.settings

    def server_time(self):
        return self.client.server_time()

    def closed_candles(self, now_ms):
        rows = self.client.request("GET", "/api/v3/klines", {
            "symbol": self.settings.symbol, "interval": self.settings.interval,
            "limit": self.settings.history_limit})
        candles = [Candle.from_kline(row) for row in rows if int(row[6]) < now_ms]
        interval = INTERVAL_MS[self.settings.interval]
        validate_candles(candles, interval)
        if not candles or now_ms - candles[-1].close_time > interval:
            raise ValueError("Latest completed candle is missing or stale")
        return candles

    def execution_price(self):
        return float(self.client.request("GET", "/api/v3/ticker/price", {"symbol": self.settings.symbol})["price"])

    def history(self, start_ms, end_ms):
        """Paginate completed klines in [start, end); public endpoint only."""
        cutoff = min(end_ms, self.server_time())
        candles = []
        cursor = start_ms
        while cursor < cutoff:
            rows = self.client.request("GET", "/api/v3/klines", {
                "symbol": self.settings.symbol, "interval": self.settings.interval,
                "startTime": cursor, "endTime": cutoff - 1, "limit": 1000})
            if not rows:
                break
            batch = [Candle.from_kline(r) for r in rows if int(r[6]) < cutoff]
            candles.extend(batch)
            next_cursor = int(rows[-1][6]) + 1
            if next_cursor <= cursor:
                raise ValueError("Historical candle pagination did not advance")
            cursor = next_cursor
        validate_candles(candles, INTERVAL_MS[self.settings.interval])
        return candles
