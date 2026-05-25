import requests
from config import BINANCE_BASE_URL, BINANCE_SYMBOL


def get_daily_closes(limit: int = 60) -> list[float]:
    url = f"{BINANCE_BASE_URL}/api/v3/klines"
    params = {"symbol": BINANCE_SYMBOL, "interval": "1d", "limit": limit}
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    # kline format: [open_time, open, high, low, close, volume, ...]
    return [float(k[4]) for k in resp.json()]
