import hashlib
import uuid
from urllib.parse import urlencode

import jwt
import requests

from config import UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, UPBIT_BASE_URL, UPBIT_MARKET

# Upbit minimum order size in KRW
MIN_ORDER_KRW = 5000
# Upbit minimum BTC volume for sell
MIN_ORDER_BTC = 0.00008


def _make_token(query_params: dict | None = None) -> str:
    payload: dict = {
        "access_key": UPBIT_ACCESS_KEY,
        "nonce": str(uuid.uuid4()),
    }
    if query_params:
        query_string = urlencode(query_params).encode()
        m = hashlib.sha512()
        m.update(query_string)
        payload["query_hash"] = m.hexdigest()
        payload["query_hash_alg"] = "SHA512"
    return jwt.encode(payload, UPBIT_SECRET_KEY, algorithm="HS256")


def _headers(query_params: dict | None = None) -> dict:
    return {"Authorization": f"Bearer {_make_token(query_params)}"}


def get_balances() -> dict[str, float]:
    resp = requests.get(f"{UPBIT_BASE_URL}/v1/accounts", headers=_headers(), timeout=10)
    resp.raise_for_status()
    return {acc["currency"]: float(acc["balance"]) for acc in resp.json()}


def buy_all_btc() -> tuple[dict | None, str | None]:
    balances = get_balances()
    krw = balances.get("KRW", 0.0)
    if krw < MIN_ORDER_KRW:
        return None, f"Insufficient KRW: {krw:.0f}"

    params = {
        "market": UPBIT_MARKET,
        "side": "bid",
        "price": str(krw),
        "ord_type": "price",  # market buy with KRW amount
    }
    resp = requests.post(
        f"{UPBIT_BASE_URL}/v1/orders",
        data=params,
        headers=_headers(params),
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json(), None


def sell_all_btc() -> tuple[dict | None, str | None]:
    balances = get_balances()
    btc = balances.get("BTC", 0.0)
    if btc < MIN_ORDER_BTC:
        return None, f"Insufficient BTC: {btc:.8f}"

    params = {
        "market": UPBIT_MARKET,
        "side": "ask",
        "volume": str(btc),
        "ord_type": "market",
    }
    resp = requests.post(
        f"{UPBIT_BASE_URL}/v1/orders",
        data=params,
        headers=_headers(params),
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json(), None
