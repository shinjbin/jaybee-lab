"""Binance supplies completed signal candles; Upbit supplies execution prices."""
from binance_client import BinanceMarketDataClient
from upbit_trading import UpbitMarketDataClient


class BinanceSignalUpbitExecutionMarket:
    def __init__(self, binance, upbit):
        self.signal_market = BinanceMarketDataClient(binance)
        self.execution_market = UpbitMarketDataClient(upbit)

    def server_time(self):
        return self.signal_market.server_time()

    def closed_candles(self, now_ms):
        return self.signal_market.closed_candles(now_ms)

    def execution_price(self):
        return self.execution_market.execution_price()
