from __future__ import annotations

import logging
from datetime import datetime, timezone

from binance_client import BinanceError, MarketDataClient
from config import Settings
from models import Signal
from order_executor import BinanceOrderExecutor, D, OrderExecutor
from state_repository import StateRepository, encode
from strategy import Strategy

log = logging.getLogger(__name__)
TERMINAL = {"FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"}


class PendingOrderUncertain(RuntimeError):
    pass


def decision_record(decision, state, settings, now_ms):
    return {"date": datetime.fromtimestamp(decision.candle.open_time / 1000, timezone.utc).date().isoformat(),
            "open_time": decision.candle.open_time, "close_time": decision.candle.close_time,
            "evaluated_at": now_ms, "close": decision.candle.close, "sma": decision.sma,
            "std": decision.std, "upper_band": decision.upper, "previous_close": decision.previous_close,
            "previous_upper": decision.previous_upper, "position": state.position.value,
            "signal": decision.signal.value, "period": settings.bollinger_period,
            "stddev": settings.bollinger_stddev, "dry_run": settings.dry_run,
            "signal_exchange": "binance", "signal_symbol": settings.signal_market_symbol,
            "execution_exchange": settings.exchange, "execution_symbol": settings.symbol,
            "virtual_order_price": None, "order_quantity": None}


class TradingBot:
    def __init__(self, settings: Settings, market: MarketDataClient, strategy: Strategy,
                 executor: OrderExecutor, repository: StateRepository):
        self.settings, self.market, self.strategy = settings, market, strategy
        self.executor, self.repository = executor, repository

    def run_once(self):
        with self.repository.lock():
            state = self.repository.load()
            if state.pending_order:
                if self.settings.dry_run:
                    return self._submit_pending(state)
                if not state.pending_order.get("attempted"):
                    # No request was attempted yet. Account may have changed during downtime.
                    intent = state.pending_order
                    try:
                        refreshed = self.executor.prepare(Signal(intent["side"]), state,
                            self.market.execution_price(), intent["candle_time"])
                    except ValueError as exc:
                        self._complete(state, event={"type": "RECOVERY_VALIDATION_FAILED", "error": str(exc)})
                        return None
                    intent.update(refreshed)
                    self.repository.save(state)
                    return self._submit_pending(state)
                try:
                    order = self.executor.query(state.pending_order)
                except BinanceError as exc:
                    if exc.code == -2013:
                        raise PendingOrderUncertain(
                            "Pending order not found; no automatic resubmission. Verify exchange history: "
                            + state.pending_order["client_id"]) from None
                    raise
                return self._accept_response(state, order)

            now = self.market.server_time()
            candles = self.market.closed_candles(now)
            if len(candles) < self.strategy.required_candles:
                raise ValueError("Insufficient completed history for previous/current Bollinger bands")
            candle = candles[-1]
            if state.last_processed_open_time is not None and candle.open_time <= state.last_processed_open_time:
                return None
            # On restart evaluate latest closed candle only: do not replay old signals at today's price.
            if isinstance(self.executor, BinanceOrderExecutor):
                # Upbit balances/order limits use the execution-market quote currency,
                # never the Binance USDT close used to calculate the signal.
                balance_price = self.market.execution_price() if self.settings.exchange == "upbit" else candle.close
                self.executor.refresh(state, balance_price)
            decision = self.strategy.evaluate(candles, state.position)
            record = decision_record(decision, state, self.settings, now)
            self.repository.save(state, decision=record)
            if decision.signal == Signal.HOLD:
                state.last_processed_open_time = candle.open_time
                self.repository.save(state, decision=record)
                log.info("DAILY %s", encode(record))
                return record

            price = self.market.execution_price()
            try:
                intent = self.executor.prepare(decision.signal, state, price, candle.open_time)
            except ValueError as exc:
                # Definite local validation failure; no order was sent.
                state.last_processed_open_time = candle.open_time
                record["order_error"] = str(exc)
                self.repository.save(state, decision=record, event={"type": "VALIDATION_FAILED", **record})
                log.warning("DAILY %s", encode(record))
                return record
            record["virtual_order_price"] = intent["estimated_price"] if self.settings.dry_run else None
            record["order_quantity"] = intent["estimated_quantity"]
            intent.update(decision=record, attempted=False, created_at=now)
            state.pending_order = intent
            self.repository.save(state, decision=record)
            log.info("DAILY %s", encode(record))
            return self._submit_pending(state)

    def _submit_pending(self, state):
        intent = state.pending_order
        # Crash after this durable flag is ambiguous; reconciliation must not submit again.
        intent["attempted"] = True
        self.repository.save(state)
        if self.settings.dry_run:
            trade = self.executor.fill(intent, state, self.market.server_time())
            self._complete(state, trade)
            return trade
        try:
            order = self.executor.submit(intent)
        except BinanceError as exc:
            if exc.uncertain or exc.code is None or exc.status is None or exc.status >= 500:
                self.repository.save(state, event={"type": "ORDER_UNCERTAIN", "client_id": intent["client_id"], "error": str(exc)})
                raise PendingOrderUncertain("Order result unknown; will query " + intent["client_id"]) from None
            # A confirmed API rejection does not change position. This candle will not resubmit.
            self._complete(state, event={"type": "ORDER_REJECTED", "client_id": intent["client_id"], "error": str(exc)})
            log.error("Order rejected: %s", exc)
            return None
        # Keep original FULL response (commission details) even if reconciliation later fails.
        intent["response"] = order
        self.repository.save(state)
        return self._accept_response(state, order)

    def _accept_response(self, state, order):
        intent = state.pending_order
        if (order.get("symbol") != self.settings.symbol or order.get("side") != intent["side"]
                or order.get("clientOrderId") != intent["client_id"]):
            raise PendingOrderUncertain("Order response does not match persisted intent")
        status = order["status"]
        quantity = D(order["executedQty"])
        state.last_order_id = str(order["orderId"])
        if quantity > 0:
            receipt = intent.get("response", {})
            if not order.get("fills") and receipt.get("executedQty") == order.get("executedQty"):
                order = {**order, "fills": receipt.get("fills")}
            trade = self.executor.confirmed_trade(intent, order, state)
            if status not in TERMINAL:
                changed = intent.get("confirmed_quantity") != str(quantity)
                intent["confirmed_quantity"] = str(quantity)
                self.repository.save(state, event={"type": "PARTIAL_FILL", **trade} if changed else None)
                log.warning("Order still active; new orders blocked: %s", intent["client_id"])
                return None
            self._complete(state, trade)
            return trade
        if status in TERMINAL:
            if status == "FILLED":
                raise PendingOrderUncertain("FILLED order has no executed quantity")
            self._complete(state, event={"type": "UNFILLED_TERMINAL", "client_id": intent["client_id"],
                                         "order_id": state.last_order_id, "status": status})
            return None
        self.repository.save(state)
        log.info("Waiting for order %s (%s)", intent["client_id"], status)
        return None

    def _complete(self, state, trade=None, event=None):
        intent = state.pending_order
        state.last_processed_open_time = intent["candle_time"]
        state.pending_order = None
        record = intent["decision"]
        if event is not None:
            record["order_error"] = event
        self.repository.save(state, decision=record, trade=trade, event=event)
        if trade:
            log.info("TRADE %s", encode(trade))
