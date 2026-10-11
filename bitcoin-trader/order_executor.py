from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from decimal import Decimal, ROUND_DOWN

from binance_client import BinanceClient
from config import Settings
from models import BotState, Position, Signal
from position_manager import PositionManager


def D(value):
    return Decimal(str(value))


def floor_step(quantity, step):
    return (quantity / step).to_integral_value(rounding=ROUND_DOWN) * step if step else quantity


class SymbolRules:
    def __init__(self, info):
        self.base_asset, self.quote_asset = info["baseAsset"], info["quoteAsset"]
        self.quote_step = Decimal(10) ** -int(info["quoteAssetPrecision"])
        self.filters = {f["filterType"]: f for f in info["filters"]}
        self.lots = [self.filters[key] for key in ("LOT_SIZE", "MARKET_LOT_SIZE") if key in self.filters]
        self.min_notional = Decimal("0")
        self.max_notional = Decimal("0")
        for key in ("MIN_NOTIONAL", "NOTIONAL"):
            f = self.filters.get(key, {})
            if f.get("applyToMarket", f.get("applyMinToMarket", False)):
                self.min_notional = max(self.min_notional, D(f["minNotional"]))
            if f.get("applyMaxToMarket", False):
                self.max_notional = D(f["maxNotional"])

    def rounded_quantity(self, quantity):
        # Binance decimal step sizes are powers of ten; largest enabled step satisfies both.
        step = max((D(f["stepSize"]) for f in self.lots), default=Decimal("0"))
        return floor_step(quantity, step)

    def is_tradable(self, quantity, price):
        q = self.rounded_quantity(quantity)
        return q > 0 and all(q >= D(f["minQty"]) for f in self.lots) and q * price >= self.min_notional

    def validate(self, quantity, price):
        if not self.is_tradable(quantity, price):
            raise ValueError("Insufficient balance or order below Binance minimum")
        for f in self.lots:
            maximum = D(f["maxQty"])
            if maximum and quantity > maximum:
                raise ValueError("All-in/out quantity exceeds Binance maximum")
        if self.max_notional and quantity * price > self.max_notional:
            raise ValueError("Order exceeds Binance maximum notional")


class OrderExecutor(ABC):
    @abstractmethod
    def prepare(self, signal: Signal, state: BotState, price, candle_time): ...

    @abstractmethod
    def submit(self, intent): ...

    @abstractmethod
    def query(self, intent): ...


class BinanceOrderExecutor(OrderExecutor):
    def __init__(self, client: BinanceClient):
        self.client, self.settings = client, client.settings
        self.rules = None

    def refresh(self, state, price):
        self.rules = SymbolRules(self.client.symbol_info())
        account = self.client.account()
        if not account.get("canTrade", False):
            raise ValueError("Binance account cannot trade")
        PositionManager.synchronize(state, account, self.rules, D(price))
        return account

    def prepare(self, signal, state, price, candle_time):
        # Recheck balances and external open orders immediately before committing intent.
        account = self.refresh(state, price)
        PositionManager.require_allowed(state, signal)
        if self.client.open_orders():
            raise ValueError("Open Binance orders exist for this symbol")
        client_id = "bb-" + hashlib.sha256(
            f"{self.settings.symbol}:{self.settings.interval}:{candle_time}:{signal.value}".encode()
        ).hexdigest()[:29]
        params = {"symbol": self.settings.symbol, "side": signal.value, "type": "MARKET",
                  "newClientOrderId": client_id, "newOrderRespType": "FULL"}
        balances = {b["asset"]: b for b in account["balances"]}
        if signal == Signal.BUY:
            # Reserve configurable quote fee so a quote-paid commission cannot overspend.
            spend = floor_step(state.cash * D(self.settings.position_size) / (1 + D(self.settings.fee_rate)), self.rules.quote_step)
            self.rules.validate(spend / D(price), D(price))
            params["quoteOrderQty"] = format(spend, "f")
            quantity = spend / D(price)
        else:
            base = balances[self.rules.base_asset]
            if self.rules.is_tradable(D(base["locked"]), D(price)):
                raise ValueError("BTC balance is locked; cannot sell all")
            quantity = self.rules.rounded_quantity(D(base["free"]))
            self.rules.validate(quantity, D(price))
            params["quantity"] = format(quantity, "f")
        return {"client_id": client_id, "params": params, "side": signal.value,
                "candle_time": candle_time, "estimated_price": str(price), "estimated_quantity": str(quantity)}

    def submit(self, intent):
        return self.client.submit_order(intent["params"])

    def query(self, intent):
        return self.client.query_order(intent["client_id"])

    def confirmed_trade(self, intent, order, state):
        quantity = D(order["executedQty"])
        quote = D(order["cummulativeQuoteQty"])
        price = quote / quantity
        fills = order.get("fills")
        if not fills:
            fills = self.client.order_trades(order["orderId"])
        fill_quantity = sum((D(f.get("qty", "0")) for f in fills), Decimal("0"))
        if fill_quantity != quantity:
            # Trade history may lag order status; retry reconciliation, never resubmit.
            raise ValueError("Fill history incomplete; keeping order pending")
        fees = {}
        for fill in fills:
            asset = fill["commissionAsset"]
            fees[asset] = fees.get(asset, Decimal("0")) + D(fill["commission"])
        self.refresh(state, price)
        if intent["side"] == Signal.BUY.value:
            state.last_entry_price = price if state.position == Position.LONG else None
        state.last_order_id = str(order["orderId"])
        return {"side": intent["side"], "signal_candle": intent["candle_time"],
                "execution_time": order.get("transactTime", order.get("updateTime", order.get("time"))),
                "execution_price": str(price), "quantity": str(quantity), "fee": {k: str(v) for k, v in fees.items()},
                "order_id": str(order["orderId"]), "client_order_id": intent["client_id"],
                "status": order["status"], "position": state.position.value, "dry_run": False}


class SimulatedOrderExecutor(OrderExecutor):
    """Same virtual accounting used by dry-run and next-open backtests."""
    def __init__(self, settings: Settings):
        self.settings = settings

    def prepare(self, signal, state, price, candle_time):
        PositionManager.require_allowed(state, signal)
        execution = D(price) * (1 + D(self.settings.slippage_rate) if signal == Signal.BUY else 1 - D(self.settings.slippage_rate))
        if execution <= 0 or not execution.is_finite():
            raise ValueError("Invalid execution price")
        quantity = (state.cash * D(self.settings.position_size) / (execution * (1 + D(self.settings.fee_rate)))
                    if signal == Signal.BUY else state.quantity)
        if quantity <= 0:
            raise ValueError("Insufficient simulated balance")
        return {"side": signal.value, "candle_time": candle_time, "estimated_price": str(execution),
                "estimated_quantity": str(quantity), "client_id": f"sim-{candle_time}-{signal.value}",
                "budget": str(state.cash * D(self.settings.position_size)) if signal == Signal.BUY else None}

    def submit(self, intent):
        return {"status": "FILLED", "orderId": intent["client_id"]}

    def query(self, intent):
        return self.submit(intent)

    def fill(self, intent, state, execution_time):
        side = Signal(intent["side"])
        PositionManager.require_allowed(state, side)
        price, quantity = D(intent["estimated_price"]), D(intent["estimated_quantity"])
        fee = price * quantity * D(self.settings.fee_rate)
        if side == Signal.BUY:
            # Debit the exact budget, avoiding a tiny negative Decimal rounding remainder.
            state.cash -= D(intent["budget"])
            state.quantity += quantity
            state.position, state.last_entry_price = Position.LONG, price
        else:
            state.cash += price * quantity - fee
            state.quantity = Decimal("0")
            state.position, state.last_entry_price = Position.CASH, None
        state.last_order_id = intent["client_id"]
        return {"side": side.value, "signal_candle": intent["candle_time"], "execution_time": execution_time,
                "execution_price": str(price), "quantity": str(quantity), "fee": str(fee),
                "order_id": state.last_order_id, "position": state.position.value, "dry_run": True}
