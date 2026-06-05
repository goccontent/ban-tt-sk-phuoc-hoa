"""Telegram bot: đăng ký thành viên + gửi nhắc việc (polling local / webhook production)."""
import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

from deadline_rules import SOON_HOURS, deadline_alert_level, format_deadline_vi, parse_deadline
from members_store import load_members

BASE = Path(__file__).parent
CONFIG_FILE = BASE / "telegram_config.json"
USERS_FILE = BASE / "telegram_users.json"
TASKS_FILE = BASE / "tasks.json"

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


def build_reminder_message(name, task_list, now=None, all_open=False):
    if now is None:
        now = datetime.now()
    lines = [f"Chào <b>{name}</b>! Việc cần làm:", ""]
    shown = 0
    for t in sorted(task_list, key=lambda x: x["deadline"]):
        urg = urgency_label(t["deadline"], now)
        if not all_open and not urg:
            continue
        dl = format_deadline_vi(t["deadline"])
        st = STATUS_LABELS.get(t.get("status", "chua-lam"), "")
        role = t.get("_role", "")
        role_txt = f" ({role})" if role else ""
        prefix = f"{urg} " if urg else "📌 "
        lines.append(f"{prefix}<b>{dl}</b> [{st}]{role_txt}")
        lines.append(f"→ {t['desc']}")
        lines.append("")
        shown += 1
    if not shown:
        return ""
    lines.append("<i>Ban TT-SK · GX Phước Hòa</i>")
    return "\n".join(lines)


def get_member_tasks(name, tasks=None, alerts_only=False, now=None):
    """Việc của thành viên (chủ trì hoặc phối hợp)."""
    if now is None:
        now = datetime.now()
    if tasks is None:
        tasks = load_tasks()
    result = []
    for t in tasks:
        if t.get("status") == "da-dang":
            continue
        is_owner = t.get("owner") == name
        is_helper = name in (t.get("helpers") or [])
        if not is_owner and not is_helper:
            continue
        if alerts_only:
            level, _ = deadline_alert_level(t["deadline"], now)
            if not level:
                continue
        item = dict(t)
        item["_role"] = "CHỦ TRÌ" if is_owner else "PHỐI HỢP"
        result.append(item)
    return result


def send_reminder_to_user(name, alerts_only=False, dry_run=False):
    """Gửi nhắc việc cho một thành viên qua Telegram."""
    cfg = load_config()
    token = cfg.get("bot_token")
    if not token:
        return {"ok": False, "error": "Chưa cấu hình bot_token"}

    users = load_users()
    chat_id = users.get(name)
    if not chat_id:
        return {
            "ok": False,
            "error": f"{name} chưa đăng ký Telegram — nhắn bot /start {name}",
        }

    task_list = get_member_tasks(name, alerts_only=alerts_only)
    if not task_list:
        return {
            "ok": False,
            "error": "Không có việc cần nhắc" if alerts_only else "Không có việc đang mở",
        }

    msg = build_reminder_message(name, task_list, all_open=not alerts_only)
    if not msg:
        return {"ok": False, "error": "Không có việc cần nhắc"}

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "name": name,
            "chat_id": chat_id,
            "tasks": len(task_list),
            "preview": msg,
        }

    res = send_message(token, chat_id, msg)
    if res.get("ok"):
        return {"ok": True, "name": name, "chat_id": chat_id, "tasks": len(task_list)}
    return {
        "ok": False,
        "error": res.get("description") or res.get("error") or "Gửi thất bại",
    }


def build_single_task_message(name, task, role="", now=None):
    """Tin nhắc cho ĐÚNG một việc gửi tới một người."""
    if now is None:
        now = datetime.now()
    urg = urgency_label(task["deadline"], now)
    dl = format_deadline_vi(task["deadline"])
    st = STATUS_LABELS.get(task.get("status", "chua-lam"), "")
    prefix = f"{urg} " if urg else "📌 "
    role_txt = f" — {role}" if role else ""
    ctx = " · ".join(x for x in [task.get("phase"), task.get("ban")] if x)
    lines = [f"Chào <b>{name}</b>! Nhắc việc{role_txt}:", ""]
    lines.append(f"{prefix}<b>{dl}</b> [{st}]")
    if ctx:
        lines.append(f"<i>{ctx}</i>")
    lines.append(f"→ {task['desc']}")
    lines.append("")
    lines.append("<i>Ban TT-SK · GX Phước Hòa</i>")
    return "\n".join(lines)


def send_task_reminder(task_id, dry_run=False):
    """Nhắc MỘT việc cụ thể tới Chủ trì + Phối hợp đã đăng ký Telegram."""
    cfg = load_config()
    token = cfg.get("bot_token")
    if not token:
        return {"ok": False, "error": "Chưa cấu hình bot_token"}

    tasks = load_tasks()
    task = next((t for t in tasks if str(t.get("id")) == str(task_id)), None)
    if not task:
        return {"ok": False, "error": "Không tìm thấy việc"}

    users = load_users()
    owner = task.get("owner")
    helpers = task.get("helpers") or []

    # Chủ trì trước, rồi phối hợp; bỏ tên trùng/rỗng
    recipients, seen = [], set()
    for nm, role in [(owner, "CHỦ TRÌ")] + [(h, "PHỐI HỢP") for h in helpers]:
        if not nm or nm in seen:
            continue
        seen.add(nm)
        recipients.append((nm, role))

    if not recipients:
        return {"ok": False, "error": "Việc chưa có người phụ trách"}

    sent, unregistered, failed, previews = [], [], [], []
    for nm, role in recipients:
        chat_id = users.get(nm)
        if not chat_id:
            unregistered.append(nm)
            continue
        msg = build_single_task_message(nm, task, role)
        if dry_run:
            previews.append({"name": nm, "chat_id": chat_id, "preview": msg})
            continue
        res = send_message(token, chat_id, msg)
        if res.get("ok"):
            sent.append(nm)
        else:
            failed.append(nm)

    if dry_run:
        return {"ok": True, "dry_run": True, "previews": previews,
                "unregistered": unregistered}

    if not sent:
        if unregistered:
            return {"ok": False, "error": "Chưa ai đăng ký bot. Bảo họ nhắn @tnttph_bot: /start "
                    + ", /start ".join(unregistered), "unregistered": unregistered}
        return {"ok": False, "error": "Gửi thất bại", "failed": failed}

    return {"ok": True, "sent": sent, "unregistered": unregistered, "failed": failed}


def send_reminders(token=None, dry_run=False):
    cfg = load_config()
    token = token or cfg.get("bot_token")
    if not token:
        return {"ok": False, "error": "Chưa cấu hình bot_token", "sent": []}

    users = load_users()
    tasks = load_tasks()
    now = datetime.now()
    sent = []
    errors = []

    for name, chat_id in users.items():
        # Nhắc cả việc Chủ trì lẫn Phối hợp (chỉ những việc đến/quá hạn)
        reminders = get_member_tasks(name, tasks, alerts_only=True, now=now)
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
    members = load_members()
    if name not in members:
        return False, f"Tên không hợp lệ. Chọn một trong: {', '.join(members)}"
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
            valid_names = ', '.join(load_members())
            help_text = (
                "👋 <b>Ban TT-SK · Bot nhắc việc</b>\n\n"
                "Đăng ký: <code>/start Tên của bạn</code>\n"
                f"Tên hợp lệ: {valid_names}\n\n"
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
        reminders = get_member_tasks(name, alerts_only=False)
        if not reminders:
            send_message(token, chat_id, f"Không có việc đang mở, {name}!")
            return
        send_message(token, chat_id, build_reminder_message(name, reminders, all_open=True))

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
