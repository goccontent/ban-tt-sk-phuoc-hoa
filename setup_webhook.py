"""Gắn Telegram webhook sau khi có URL public."""
import os
import sys

from telegram_service import setup_webhook, test_bot, load_config

if __name__ == "__main__":
    cfg = load_config()
    token = cfg.get("bot_token") or os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("Loi: dat TELEGRAM_BOT_TOKEN trong .env hoac tab Bot nhac")
        sys.exit(1)
    me = test_bot(token)
    if me.get("ok"):
        print(f"Bot: @{me['result']['username']}")
    else:
        print("Token loi:", me)
        sys.exit(1)
    base = os.getenv("WEBHOOK_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL")
    if not base:
        print("Loi: dat WEBHOOK_BASE_URL=https://your-url trong .env")
        sys.exit(1)
    print(setup_webhook(token))
