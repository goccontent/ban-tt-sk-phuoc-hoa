"""
Server phần mềm Ban TT-SK
- Local: python server.py
- Production: gunicorn wsgi:app (Render.com miễn phí)
"""
import os
import sys
import threading
import time

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from events_store import load_events, save_events, merge_events
from import_excel import parse_excel, to_event_records
from telegram_service import (
    BASE,
    TASKS_FILE,
    handle_update,
    is_production,
    load_config,
    load_tasks,
    load_users,
    poller,
    save_config,
    save_json,
    send_reminders,
    setup_webhook,
    test_bot,
    webhook_base_url,
    webhook_secret,
)

app = Flask(__name__, static_folder=str(BASE))
CORS(app)

_initialized = False


def save_tasks(tasks):
    save_json(TASKS_FILE, tasks)


def init_app():
    global _initialized
    if _initialized:
        return
    _initialized = True
    load_events()

    if is_production():
        result = setup_webhook()
        if result.get("ok"):
            print(f"Telegram webhook OK: {result.get('webhook_url')}")
        else:
            print(f"Telegram webhook chưa sẵn sàng: {result.get('error')}")
    else:
        cfg = load_config()
        if cfg.get("enabled") and cfg.get("bot_token"):
            poller.start()
        threading.Thread(target=reminder_scheduler, daemon=True).start()


@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(BASE, path)


# --- Tasks API ---

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    return jsonify(load_tasks())


@app.route("/api/tasks", methods=["PUT"])
def put_tasks():
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"ok": False, "error": "Expected array"}), 400
    save_tasks(data)
    return jsonify({"ok": True, "count": len(data)})


# --- Events API ---

@app.route("/api/events", methods=["GET"])
def get_events():
    return jsonify(load_events())


@app.route("/api/events/import", methods=["POST"])
def import_events_excel():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Thiếu file Excel"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Chưa chọn file"}), 400

    ext = Path(f.filename).suffix.lower()
    if ext not in (".xlsx", ".xlsm"):
        return jsonify({"ok": False, "error": "Chỉ hỗ trợ file .xlsx"}), 400

    replace = request.form.get("replace", "false").lower() == "true"

    try:
        parsed, errors = parse_excel(f.stream)
        if not parsed:
            return jsonify({
                "ok": False,
                "error": "Không đọc được sự kiện nào từ file",
                "parseErrors": errors,
            }), 400

        existing = load_events()
        new_records = to_event_records(parsed, {e["id"] for e in existing})
        merged = merge_events(existing, new_records, replace=replace)
        save_events(merged)

        return jsonify({
            "ok": True,
            "imported": len(new_records),
            "added": max(0, len(merged) - len(existing)) if not replace else len(new_records),
            "total": len(merged),
            "events": merged,
            "parseErrors": errors,
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# --- Telegram API ---

@app.route("/api/telegram/config", methods=["GET"])
def tg_config_get():
    cfg = load_config()
    safe = {
        **cfg,
        "bot_token": ("••••" + cfg["bot_token"][-6:]) if cfg.get("bot_token") else "",
        "production": is_production(),
        "webhook_url": f"{webhook_base_url()}/api/telegram/webhook/{webhook_secret()}" if webhook_base_url() else "",
    }
    return jsonify(safe)


@app.route("/api/telegram/config", methods=["PUT"])
def tg_config_put():
    body = request.get_json() or {}
    cfg = load_config()
    for k in ("bot_token", "group_chat_id", "reminder_hour", "reminder_days_ahead", "enabled"):
        if k in body and body[k] is not None:
            if k == "bot_token" and str(body[k]).startswith("••••"):
                continue
            cfg[k] = body[k]
    save_config(cfg)
    if not is_production() and cfg.get("enabled") and cfg.get("bot_token"):
        poller.start()
    return jsonify({"ok": True})


@app.route("/api/telegram/users", methods=["GET"])
def tg_users():
    return jsonify(load_users())


@app.route("/api/telegram/test", methods=["POST"])
def tg_test():
    body = request.get_json() or {}
    token = body.get("bot_token") or load_config().get("bot_token")
    if not token:
        return jsonify({"ok": False, "error": "Thiếu bot_token"}), 400
    return jsonify(test_bot(token))


@app.route("/api/telegram/send", methods=["POST"])
def tg_send():
    body = request.get_json(silent=True) or {}
    return jsonify(send_reminders(dry_run=body.get("dry_run", False)))


@app.route("/api/telegram/preview", methods=["GET"])
def tg_preview():
    return jsonify(send_reminders(dry_run=True))


@app.route("/api/telegram/setup-webhook", methods=["POST"])
def tg_setup_webhook():
    """Gọi sau khi deploy để gắn bot với URL server."""
    return jsonify(setup_webhook())


@app.route("/api/telegram/webhook/<secret>", methods=["POST"])
def tg_webhook(secret):
    if secret != webhook_secret():
        return jsonify({"ok": False}), 403
    update = request.get_json(silent=True)
    if update:
        handle_update(update)
    return jsonify({"ok": True})


@app.route("/api/cron/remind", methods=["GET", "POST"])
def cron_remind():
    """
    Nhắc việc tự động — gọi từ cron-job.org (miễn phí).
    URL: https://YOUR-APP.onrender.com/api/cron/remind?key=CRON_SECRET
    """
    key = request.args.get("key") or request.headers.get("X-Cron-Key")
    expected = os.getenv("CRON_SECRET")
    if not expected or key != expected:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403
    return jsonify(send_reminders())


@app.route("/api/health", methods=["GET"])
def health():
    cfg = load_config()
    return jsonify({
        "ok": True,
        "production": is_production(),
        "bot_configured": bool(cfg.get("bot_token")),
        "webhook": webhook_base_url() or None,
    })


def reminder_scheduler():
    """Chỉ chạy local — production dùng cron-job.org."""
    if is_production():
        return
    while True:
        cfg = load_config()
        if cfg.get("enabled") and cfg.get("bot_token"):
            now = datetime.now()
            if now.hour == cfg.get("reminder_hour", 7) and now.minute < 2:
                key = f"reminder-{now.date().isoformat()}"
                flag_file = BASE / f".{key}"
                if not flag_file.exists():
                    send_reminders()
                    flag_file.write_text("sent")
        time.sleep(60)


if __name__ == "__main__":
    init_app()
    port = int(os.environ.get("PORT", 8080))
    print(f"Ban TT-SK server: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
