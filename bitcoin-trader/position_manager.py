from __future__ import annotations

from decimal import Decimal

from models import BotState, Position, Signal


class PositionManager:
    @staticmethod
    def require_allowed(state: BotState, signal: Signal):
        if (signal == Signal.BUY and state.position != Position.CASH
                or signal == Signal.SELL and state.position != Position.LONG):
            raise ValueError("Order conflicts with current position")

    @staticmethod
    def synchronize(state: BotState, account: dict, rules, price: Decimal):
        balances = {b["asset"]: b for b in account["balances"]}
        base = balances.get(rules.base_asset, {"free": "0", "locked": "0"})
        quote = balances.get(rules.quote_asset, {"free": "0", "locked": "0"})
        state.quantity = Decimal(base["free"]) + Decimal(base["locked"])
        state.cash = Decimal(quote["free"])
        state.position = Position.LONG if rules.is_tradable(state.quantity, price) else Position.CASH
        if state.position == Position.CASH:
            state.last_entry_price = None
