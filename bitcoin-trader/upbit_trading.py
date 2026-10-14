"""Upbit transport and adapters; no requests occur on import or construction."""
from __future__ import annotations

import hashlib
import math
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests

from binance_client import BinanceError, validate_candles
from models import Candle, Position, Signal
from order_executor import BinanceOrderExecutor, D, floor_step
from position_manager import PositionManager
from upbit_client import UpbitHealthClient

DAY = 86_400_000


def timestamp(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


class UpbitRequestError(BinanceError):
    """Exchange-neutral bot recovery uses code -2013 for missing orders."""
    def __init__(self, name=None, status=None, retry_after=0, uncertain=False):
        super().__init__(-2013 if name == "order_not_found" else name, status, retry_after, uncertain)
        self.args = (f"Upbit request failed HTTP={status} uncertain={uncertain}",)


class UpbitClient(UpbitHealthClient):
    def __init__(self, settings, session=None, sleep=time.sleep, clock=time.monotonic):
        super().__init__(settings.base_url, settings.api_key, settings.api_secret,
                         settings.timeout_seconds, session)
        self.settings, self.sleep, self.clock = settings, sleep, clock
        self.blocked_until = 0
        self.last_server_ms = None

    def request(self, method, path, params=None, signed=False):
        params = params or {}
        attempts = self.settings.read_retries if method == "GET" else 1
        for attempt in range(attempts):
            remaining = self.blocked_until - self.clock()
            if remaining > 0:
                raise UpbitRequestError(status=429, retry_after=remaining)
            headers = {"Accept": "application/json"}
            if signed:
                headers["Authorization"] = "Bearer " + self._token(params)
            kwargs = {"params": params} if method == "GET" else {"json": params}
            try:
                response = self.session.request(method, self.base_url + path, headers=headers,
                    timeout=self.timeout, allow_redirects=False, **kwargs)
                try:
                    data = response.json()
                except ValueError:
                    raise UpbitRequestError(status=response.status_code, uncertain=method != "GET") from None
                error = data.get("error") if isinstance(data, dict) else None
                if response.status_code >= 300 or error:
                    name = error.get("name") if isinstance(error, dict) else None
                    retry_after = 0
                    if response.status_code in (418, 429):
                        try:
                            retry_after = float(response.headers.get("Retry-After", 60))
                        except (ValueError, TypeError):
                            retry_after = 60
                        if not math.isfinite(retry_after) or retry_after <= 0:
                            retry_after = 60
                        self.blocked_until = self.clock() + retry_after
                    uncertain = method != "GET" and (response.status_code >= 500 or
                        300 <= response.status_code < 400 or name in {"duplicate_identifier", "validation_error"})
                    exc = UpbitRequestError(name, response.status_code, retry_after, uncertain)
                    if method == "GET" and response.status_code >= 500 and attempt + 1 < attempts:
                        self.sleep(2 ** attempt)
                        continue
                    raise exc
                # Upbit has no dedicated server-time endpoint. HTTP Date is authoritative,
                # conservative to whole seconds, and never replaced with the local clock.
                self.last_server_ms = None
                if response.headers.get("Date"):
                    try:
                        self.last_server_ms = int(parsedate_to_datetime(response.headers["Date"]).timestamp() * 1000)
                    except (ValueError, TypeError, OverflowError):
                        pass
                return data
            except requests.RequestException:
                if method == "GET" and attempt + 1 < attempts:
                    self.sleep(2 ** attempt)
                    continue
                raise UpbitRequestError(uncertain=method != "GET") from None

    def server_time(self):
        self.request("GET", "/v1/ticker", {"markets": self.settings.symbol})
        if self.last_server_ms is None:
            raise ValueError("Upbit HTTP Date is missing; cannot establish candle close")
        return self.last_server_ms - 2000  # Allow candle publication after the boundary.

    def symbol_info(self):
        markets = self.request("GET", "/v1/market/all")
        if not isinstance(markets, list) or not any(m.get("market") == self.settings.symbol for m in markets):
            raise ValueError("Upbit market is unavailable")
        return {"symbol": self.settings.symbol}

    def account(self):
        rows = self.request("GET", "/v1/accounts", signed=True)
        if not isinstance(rows, list) or any(not isinstance(b, dict) or
                not {"currency", "balance", "locked"} <= b.keys() for b in rows):
            raise ValueError("Invalid Upbit account response")
        return {"balances": [{"asset": b["currency"], "free": b["balance"], "locked": b["locked"]} for b in rows]}

    def chance(self):
        return self.request("GET", "/v1/orders/chance", {"market": self.settings.symbol}, signed=True)

    def open_orders(self):
        rows = self.request("GET", "/v1/orders/open",
            {"market": self.settings.symbol, "states[]": ["wait", "watch"], "limit": 1}, signed=True)
        if not isinstance(rows, list):
            raise ValueError("Invalid Upbit open order response")
        return rows

    def test_market_buy(self):
        """Validate the minimum-sized market buy without creating an order."""
        if not (self.settings.api_key and self.settings.api_secret):
            raise ValueError("Upbit order test requires credentials")
        rules = UpbitRules(self.chance(), self.settings.symbol)
        amount = rules.bid_min
        if amount <= 0 or floor_step(amount, rules.quote_step) != amount:
            raise ValueError("Invalid Upbit minimum test amount")
        rules.validate_amount(amount, rules.bid_min)
        params = {"market": self.settings.symbol, "side": "bid", "ord_type": "price",
                  "price": format(amount, "f")}
        # Fixed endpoint, no fallback to /orders, no retries and no order reconciliation.
        result = self.request("POST", "/v1/orders/test", params, signed=True)
        if (not isinstance(result, dict) or result.get("market") != self.settings.symbol or
                result.get("side") != "bid" or result.get("ord_type") != "price" or
                D(result.get("price", -1)) != amount or D(result.get("executed_volume", -1)) != 0):
            raise ValueError("Invalid Upbit order-test response")
        # Discard the synthetic UUID/identifier; these cannot be queried or cancelled.
        return {"market": self.settings.symbol, "price": str(amount)}

    def submit_order(self, params):
        # Exactly one POST. Timeouts are reconciled by identifier, never retried.
        return self.normalize_order(self.request("POST", "/v1/orders", params, signed=True))

    def query_order(self, client_id):
        return self.normalize_order(self.request("GET", "/v1/order", {"identifier": client_id}, signed=True))

    def normalize_order(self, order):
        states = {"wait": "NEW", "watch": "NEW", "done": "FILLED", "cancel": "CANCELED"}
        if order.get("state") not in states or order.get("side") not in {"bid", "ask"}:
            raise ValueError("Unknown Upbit order state or side; keep pending")
        trades = order.get("trades") or []
        funds = sum((D(t["funds"]) for t in trades), D(0))
        times = [timestamp(t["created_at"]) for t in trades]
        return {"symbol": order["market"], "side": "BUY" if order["side"] == "bid" else "SELL",
            "clientOrderId": order.get("identifier"), "orderId": order["uuid"],
            "status": states[order["state"]], "executedQty": order["executed_volume"],
            "cummulativeQuoteQty": str(funds), "upbit_trades": trades,
            "paid_fee": order.get("paid_fee"), "transactTime": max(times) if times else None,
            "exchange_state": order["state"]}


class UpbitMarketDataClient:
    def __init__(self, client):
        self.client, self.settings = client, client.settings

    def server_time(self):
        return self.client.server_time()

    @staticmethod
    def candle(row):
        opened = timestamp(row["candle_date_time_utc"])
        return Candle(opened, float(row["opening_price"]), float(row["high_price"]),
            float(row["low_price"]), float(row["trade_price"]), float(row["candle_acc_trade_volume"]),
            opened + DAY - 1)

    def closed_candles(self, now_ms):
        rows = self.client.request("GET", "/v1/candles/days",
            {"market": self.settings.symbol, "count": self.settings.history_limit})
        if any(r.get("market") != self.settings.symbol for r in rows):
            raise ValueError("Unexpected Upbit candle market")
        candles = sorted((self.candle(r) for r in rows), key=lambda c: c.open_time)
        candles = [c for c in candles if c.close_time < now_ms]
        validate_candles(candles, DAY)
        if not candles or now_ms - candles[-1].close_time > DAY:
            raise ValueError("Latest completed Upbit candle missing or stale")
        return candles

    def execution_price(self):
        rows = self.client.request("GET", "/v1/ticker", {"markets": self.settings.symbol})
        if len(rows) != 1 or rows[0].get("market") != self.settings.symbol:
            raise ValueError("Unexpected Upbit ticker market")
        price = float(rows[0]["trade_price"])
        if not math.isfinite(price) or price <= 0:
            raise ValueError("Invalid Upbit price")
        return price

    def history(self, start_ms, end_ms):
        cutoff = min(end_ms, self.server_time())
        cursor, result = cutoff, []
        while cursor > start_ms:
            rows = self.client.request("GET", "/v1/candles/days", {"market": self.settings.symbol,
                "count": 200, "to": datetime.fromtimestamp(cursor / 1000, timezone.utc).isoformat()})
            if not rows:
                break
            if any(r.get("market") != self.settings.symbol for r in rows):
                raise ValueError("Unexpected Upbit candle market")
            batch = [self.candle(r) for r in rows]
            next_cursor = min(c.open_time for c in batch)
            if next_cursor >= cursor:
                raise ValueError("Upbit history pagination did not advance")
            result.extend(c for c in batch if start_ms <= c.open_time < end_ms and c.close_time < cutoff)
            cursor = next_cursor
        result.sort(key=lambda c: c.open_time)
        validate_candles(result, DAY)
        return result


class UpbitRules:
    def __init__(self, chance, symbol):
        market = chance["market"]
        quote, base = symbol.split("-")
        if (market["id"] != symbol or market["state"] != "active" or
                market["bid"]["currency"] != quote or market["ask"]["currency"] != base or
                "price" not in market["bid_types"] or "market" not in market["ask_types"] or
                not {"bid", "ask"} <= set(market["order_sides"])):
            raise ValueError("Upbit market does not support required market orders")
        self.base_asset, self.quote_asset = base, quote
        self.bid_min, self.ask_min = D(market["bid"]["min_total"]), D(market["ask"]["min_total"])
        self.maximum, self.bid_fee = D(market["max_total"]), D(chance["bid_fee"])
        if not all(x.is_finite() and x >= 0 for x in (self.bid_min, self.ask_min, self.maximum, self.bid_fee)):
            raise ValueError("Invalid Upbit order policy")
        self.quote_step = D("1") if quote == "KRW" else D("0.00000001")

    def rounded_quantity(self, quantity):
        return floor_step(quantity, D("0.00000001"))

    def is_tradable(self, quantity, price):
        q = self.rounded_quantity(quantity)
        return q > 0 and q * price >= self.ask_min

    def validate_amount(self, amount, minimum):
        if not amount.is_finite() or amount <= 0 or amount < minimum or (self.maximum and amount > self.maximum):
            raise ValueError("Amount outside Upbit order limits")


class UpbitOrderExecutor(BinanceOrderExecutor):
    """Reuse the common pending-order contract, with Upbit-specific preparation/fees."""
    def refresh(self, state, price):
        self.rules = UpbitRules(self.client.chance(), self.settings.symbol)
        account = self.client.account()
        PositionManager.synchronize(state, account, self.rules, D(price))
        return account

    def prepare(self, signal, state, price, candle_time):
        account = self.refresh(state, price)
        PositionManager.require_allowed(state, signal)
        if self.client.open_orders():
            raise ValueError("Open Upbit orders exist for this market")
        client_id = "upbit-bb-" + hashlib.sha256(
            f"{self.settings.symbol}:{self.settings.interval}:{candle_time}:{signal.value}".encode()).hexdigest()[:40]
        params = {"market": self.settings.symbol, "side": "bid" if signal == Signal.BUY else "ask",
                  "identifier": client_id}
        if signal == Signal.BUY:
            spend = floor_step(state.cash * D(self.settings.position_size) / (1 + self.rules.bid_fee), self.rules.quote_step)
            self.rules.validate_amount(spend, self.rules.bid_min)
            params.update(ord_type="price", price=format(spend, "f"))
            quantity = spend / D(price)
        else:
            base = next(b for b in account["balances"] if b["asset"] == self.rules.base_asset)
            if D(base["locked"]) > 0:
                raise ValueError("Upbit BTC is locked; cannot sell all")
            quantity = self.rules.rounded_quantity(D(base["free"]))
            self.rules.validate_amount(quantity * D(price), self.rules.ask_min)
            params.update(ord_type="market", volume=format(quantity, "f"))
        return {"client_id": client_id, "params": params, "side": signal.value, "candle_time": candle_time,
                "estimated_price": str(price), "estimated_quantity": str(quantity)}

    def confirmed_trade(self, intent, order, state):
        quantity, funds = D(order["executedQty"]), D(order["cummulativeQuoteQty"])
        trades = order.get("upbit_trades", [])
        if (not trades or sum((D(t["volume"]) for t in trades), D(0)) != quantity or
                funds <= 0 or order.get("paid_fee") is None or order.get("transactTime") is None):
            raise ValueError("Upbit fill details incomplete; keep order pending")
        price, fee = funds / quantity, D(order["paid_fee"])
        if not fee.is_finite() or fee < 0:
            raise ValueError("Invalid Upbit paid fee; keep order pending")
        self.refresh(state, price)
        if intent["side"] == Signal.BUY.value:
            state.last_entry_price = price if state.position == Position.LONG else None
        state.last_order_id = str(order["orderId"])
        return {"side": intent["side"], "signal_candle": intent["candle_time"],
            "execution_time": order["transactTime"], "execution_price": str(price), "quantity": str(quantity),
            "fee": {self.rules.quote_asset: str(fee)}, "order_id": state.last_order_id,
            "client_order_id": intent["client_id"], "status": order["status"],
            "exchange_state": order["exchange_state"], "exchange": "upbit",
            "position": state.position.value, "dry_run": False}
