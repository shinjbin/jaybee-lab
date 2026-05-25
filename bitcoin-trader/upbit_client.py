import pyupbit

from config import UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, UPBIT_MARKET

MIN_ORDER_KRW = 5000
MIN_ORDER_BTC = 0.00008

_upbit = pyupbit.Upbit(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY)


def validate_connection() -> None:
    """Verify Upbit API keys are valid by fetching balances. Raises on failure."""
    if not UPBIT_ACCESS_KEY or not UPBIT_SECRET_KEY:
        raise ValueError("UPBIT_ACCESS_KEY and UPBIT_SECRET_KEY must be set")
    balances = _upbit.get_balances()
    if balances is None:
        raise ConnectionError("Upbit API returned None — check API keys and permissions")
    krw = next((float(b["balance"]) for b in balances if b["currency"] == "KRW"), 0.0)
    btc = next((float(b["balance"]) for b in balances if b["currency"] == "BTC"), 0.0)
    print(f"[Upbit] Connected OK — KRW: {krw:,.0f}원  BTC: {btc:.8f}")


def buy_all_btc() -> tuple[dict | None, str | None]:
    krw = _upbit.get_balance("KRW")
    if krw is None or krw < MIN_ORDER_KRW:
        return None, f"Insufficient KRW: {krw}"
    result = _upbit.buy_market_order(UPBIT_MARKET, krw)
    return result, None


def sell_all_btc() -> tuple[dict | None, str | None]:
    btc = _upbit.get_balance("BTC")
    if btc is None or btc < MIN_ORDER_BTC:
        return None, f"Insufficient BTC: {btc}"
    result = _upbit.sell_market_order(UPBIT_MARKET, btc)
    return result, None
