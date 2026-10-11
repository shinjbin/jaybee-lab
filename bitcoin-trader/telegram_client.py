import logging

import requests

from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

log = logging.getLogger(__name__)


def send(text: str, *, token=None, chat_id=None, timeout=10, session=None) -> bool:
    token = TELEGRAM_BOT_TOKEN if token is None else token
    chat_id = TELEGRAM_CHAT_ID if chat_id is None else chat_id
    if not token or not chat_id:
        log.warning("Telegram notification skipped: credentials not configured")
        return False
    try:
        response = (session or requests).post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=timeout,
        )
        response.raise_for_status()
        if response.json().get("ok") is not True:
            log.warning("Telegram rejected notification")
            return False
        log.info("Telegram notification delivered")
        return True
    except Exception:
        log.warning("Telegram send failed")
        return False
