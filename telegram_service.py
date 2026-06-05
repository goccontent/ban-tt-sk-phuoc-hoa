"""Telegram bot: đăng ký thành viên + gửi nhắc việc (polling local / webhook production)."""
import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

from deadline_rules import SOON_HOURS, deadline_alert_level, format_deadline_vi, parse_deadline

BASE = Path(__file__).parent
CONFIG_FILE = BASE / "telegram_config.json"
USERS_FILE = BASE / "telegram_users.json"
TASKS_FILE = BASE / "tasks.json"

MEMBER_NAMES = [
    "Khánh Huyền", "Minh", "Trọng", "Kiều Duyên",
    "Gioakim", "CTV A", "CTV B", "CTV C",
]

STATUS_LABELS = {
    "chua-lam": "Chưa làm",
    "dang-lam": "Đang làm",
    "cho-duyet": "Chờ duyệt",
    "da-dang": "Đã xong",
}


def load_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return default


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_config():
    cfg = load_json(CONFIG_FILE, {
        "bot_token": "",
        "group_chat_id": "",
        "reminder_hour": 7,
        "reminder_days_ahead": 3,
        "enabled": False,
    })
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        cfg["bot_token"] = os.getenv("TELEGRAM_BOT_TOKEN")
        cfg["enabled"] = True
    if os.getenv("TELEGRAM_GROUP_CHAT_ID"):
        cfg["group_chat_id"] = os.getenv("TELEGRAM_GROUP_CHAT_ID")
    return cfg


def is_production():
    return bool(os.getenv("RENDER") or os.getenv("DEPLOY_MODE") == "production")


def webhook_base_url():
    return (os.getenv("RENDER_EXTERNAL_URL") or os.getenv("WEBHOOK_BASE_URL") or "").rstrip("/")


def webhook_secret():
    return os.getenv("WEBHOOK_SECRET", "ban-tt-sk")


def setup_webhook(token=None):
    """Đăng ký webhook Telegram (bắt buộc khi deploy Render)."""
    cfg = load_config()
    token = token or cfg.get("bot_token")
    base = webhook_base_url()
    if not token or not base:
        return {"ok": False, "error": "Thiếu TELEGRAM_BOT_TOKEN hoặc URL server (RENDER_EXTERNAL_URL)"}
    url = f"{base}/api/telegram/webhook/{webhook_secret()}"
    try:
        requests.post(api_url(token, "deleteWebhook"), timeout=10)
        r = requests.post(
            api_url(token, "setWebhook"),
            json={"url": url, "allowed_updates": ["message", "edited_message"]},
            timeout=15,
        )
        data = r.json()
        if data.get("ok"):
            return {"ok": True, "webhook_url": url, "description": data.get("description", "")}
        return {"ok": False, "error": data.get("description", "setWebhook failed")}
    except requests.RequestException as exc:
        return {"ok": False, "error": str(exc)}


def remove_webhook(token=None):
    cfg = load_config()
    token = token or cfg.get("bot_token")
    if not token:
        return {"ok": False, "error": "Thiếu token"}
    r = requests.post(api_url(token, "deleteWebhook"), timeout=10)
    return r.json()


def save_config(cfg):
    save_json(CONFIG_FILE, cfg)


def load_users():
    return load_json(USERS_FILE, {})


def save_users(users):
    save_json(USERS_FILE, users)


def load_tasks():
    return load_json(TASKS_FILE, [])


def api_url(token, method):
    return f"https://api.telegram.org/bot{token}/{method}"


def send_message(token, chat_id, text, parse_mode="HTML"):
    if not token or not chat_id:
        return {"ok": False, "error": "Thiếu token hoặc chat_id"}
    try:
        r = requests.post(
            api_url(token, "sendMessage"),
            json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
            timeout=15,
        )
        return r.json()
    except requests.RequestException as e:
        return {"ok": False, "error": str(e)}


def urgency_label(deadline_str, now=None):
    level, text = deadline_alert_level(deadline_str, now)
    if level == "overdue":
        return "🔴 QUÁ HẠN"
    if level == "soon":
        return "🟠 GẦN ĐẾN HẠN"
    return ""


def build_reminder_message(name, task_list, now=None):
    if now is None:
        now = datetime.now()
    lines = [f"Chào <b>{name}</b>! Việc cần làm:", ""]
    for t in sorted(task_list, key=lambda x: x["deadline"]):
        urg = urgency_label(t["deadline"], now)
        if not urg:
            continue
        dl = format_deadline_vi(t["deadline"])
        st = STATUS_LABELS.get(t.get("status", "chua-lam"), "")
        lines.append(f"{urg} <b>{dl}</b> [{st}]")
        lines.append(f"→ {t['desc']}")
        lines.append("")
    lines.append("<i>Ban TT-SK · GX Phước Hòa</i>")
    return "\n".join(lines)


def get_reminders_for_user(name, tasks=None, days_ahead=3, now=None):
    if now is None:
        now = datetime.now()
    if tasks is None:
        tasks = load_tasks()
    result = []
    for t in tasks:
        if t.get("status") == "da-dang":
            continue
        if t.get("owner") != name:
            continue
        level, _ = deadline_alert_level(t["deadline"], now)
        if level:
            result.append(t)
    return result


def send_reminders(token=None, days_ahead=None, dry_run=False):
    cfg = load_config()
    token = token or cfg.get("bot_token")
    if not token:
        return {"ok": False, "error": "Chưa cấu hình bot_token", "sent": []}

    days_ahead = days_ahead if days_ahead is not None else cfg.get("reminder_days_ahead", 3)
    users = load_users()
    tasks = load_tasks()
    now = datetime.now()
    sent = []
    errors = []

    for name, chat_id in users.items():
        reminders = get_reminders_for_user(name, tasks, days_ahead, now)
        if not reminders:
            continue
        msg = build_reminder_message(name, reminders, now)
        if dry_run:
            sent.append({"name": name, "chat_id": chat_id, "tasks": len(reminders), "preview": msg})
            continue
        res = send_message(token, chat_id, msg)
        if res.get("ok"):
            sent.append({"name": name, "chat_id": chat_id, "tasks": len(reminders)})
        else:
            errors.append({"name": name, "error": res.get("description") or res.get("error")})

    # Nhắc lên nhóm (tổng hợp)
    group_id = cfg.get("group_chat_id")
    if group_id and not dry_run:
        alerts = []
        for t in tasks:
            if t.get("status") == "da-dang":
                continue
            level, label = deadline_alert_level(t["deadline"], now)
            if level:
                alerts.append((t, label))
        if alerts:
            lines = ["<b>📋 Việc cần chú ý:</b>", ""]
            for t, label in sorted(alerts, key=lambda x: x[0]["deadline"])[:15]:
                icon = "🔴" if label == "QUÁ HẠN" else "🟠"
                lines.append(
                    f"{icon} <b>{t['owner']}</b> [{label}] "
                    f"{format_deadline_vi(t['deadline'])}: {t['desc'][:80]}"
                )
            send_message(token, group_id, "\n".join(lines))

    return {"ok": True, "sent": sent, "errors": errors, "dry_run": dry_run}


def test_bot(token):
    r = requests.get(api_url(token, "getMe"), timeout=10)
    return r.json()


def register_user(name, chat_id):
    if name not in MEMBER_NAMES:
        return False, f"Tên không hợp lệ. Chọn một trong: {', '.join(MEMBER_NAMES)}"
    users = load_users()
    users[name] = str(chat_id)
    save_users(users)
    return True, f"Đã đăng ký {name} ✓"


def handle_update(update, token=None):
    """Xử lý 1 update từ Telegram."""
    if token is None:
        token = load_config().get("bot_token")
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            help_text = (
                "👋 <b>Ban TT-SK · Bot nhắc việc</b>\n\n"
                "Đăng ký: <code>/start Tên của bạn</code>\n"
                f"Tên hợp lệ: {', '.join(MEMBER_NAMES)}\n\n"
                "VD: <code>/start Khánh Huyền</code>"
            )
            send_message(token, chat_id, help_text)
            return
        name = parts[1].strip()
        ok, reply = register_user(name, chat_id)
        send_message(token, chat_id, reply)

    elif text.startswith("/viectoi"):
        users = load_users()
        name = next((n for n, cid in users.items() if str(cid) == str(chat_id)), None)
        if not name:
            send_message(token, chat_id, "Chưa đăng ký. Gõ: /start Tên của bạn")
            return
        reminders = get_reminders_for_user(name, days_ahead=7)
        if not reminders:
            send_message(token, chat_id, f"Không có việc sắp tới, {name}!")
            return
        send_message(token, chat_id, build_reminder_message(name, reminders))

    elif text.startswith("/help"):
        send_message(token, chat_id,
            "<b>Lệnh bot:</b>\n"
            "/start Tên — Đăng ký nhận nhắc\n"
            "/viectoi — Xem việc của bạn\n"
            "/help — Trợ giúp")


class TelegramPoller:
    def __init__(self):
        self._thread = None
        self._stop = threading.Event()
        self._offset = 0

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        while not self._stop.is_set():
            if is_production():
                time.sleep(30)
                continue
            cfg = load_config()
            token = cfg.get("bot_token")
            if not token or not cfg.get("enabled"):
                time.sleep(5)
                continue
            try:
                r = requests.get(
                    api_url(token, "getUpdates"),
                    params={"offset": self._offset, "timeout": 30},
                    timeout=35,
                )
                data = r.json()
                if data.get("ok"):
                    for upd in data.get("result", []):
                        self._offset = upd["update_id"] + 1
                        handle_update(upd, token)
            except requests.RequestException:
                time.sleep(5)


poller = TelegramPoller()
