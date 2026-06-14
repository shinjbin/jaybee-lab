import os

BINANCE_BASE_URL = os.getenv("BINANCE_BASE_URL", "https://api.binance.com")
BINANCE_SYMBOL = os.getenv("BINANCE_SYMBOL", "BTCUSDT")

UPBIT_ACCESS_KEY = os.getenv("UPBIT_ACCESS_KEY", "")
UPBIT_SECRET_KEY = os.getenv("UPBIT_SECRET_KEY", "")
UPBIT_BASE_URL = os.getenv("UPBIT_BASE_URL", "https://api.upbit.com")
UPBIT_MARKET = os.getenv("UPBIT_MARKET", "KRW-BTC")

SHORT_MA = int(os.getenv("SHORT_MA", "5"))
LONG_MA = int(os.getenv("LONG_MA", "20"))
RSI_PERIOD = int(os.getenv("RSI_PERIOD", "14"))
RSI_ENABLED = os.getenv("RSI_ENABLED", "true").lower() == "true"
RSI_BUY_THRESHOLD = float(os.getenv("RSI_BUY_THRESHOLD", "70"))
RSI_SELL_THRESHOLD = float(os.getenv("RSI_SELL_THRESHOLD", "30"))

CHECK_INTERVAL_HOURS = int(os.getenv("CHECK_INTERVAL_HOURS", "1"))

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
