"""Sao lưu tasks + events vào thư mục backups/."""
import json
from datetime import datetime
from pathlib import Path

from events_store import EVENTS_FILE, load_events
from telegram_service import TASKS_FILE, load_tasks

BASE = Path(__file__).parent
BACKUPS_DIR = BASE / "backups"
MAX_BACKUPS = 40


def _ensure_dir():
    BACKUPS_DIR.mkdir(exist_ok=True)


def _prune():
    files = sorted(BACKUPS_DIR.glob("backup-*.json"), reverse=True)
    for old in files[MAX_BACKUPS:]:
        try:
            old.unlink()
        except OSError:
            pass


def create_backup(label="auto"):
    _ensure_dir()
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    payload = {
        "timestamp": datetime.now().isoformat(),
        "label": label,
        "tasks": load_tasks(),
        "events": load_events(),
    }
    path = BACKUPS_DIR / f"backup-{ts}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _prune()
    return {"ok": True, "file": path.name, "path": str(path), "timestamp": payload["timestamp"]}


def list_backups():
    _ensure_dir()
    files = sorted(BACKUPS_DIR.glob("backup-*.json"), reverse=True)
    result = []
    for f in files[:MAX_BACKUPS]:
        try:
            meta = json.loads(f.read_text(encoding="utf-8"))
            result.append({
                "file": f.name,
                "timestamp": meta.get("timestamp"),
                "label": meta.get("label", ""),
                "tasks": len(meta.get("tasks") or []),
                "events": len(meta.get("events") or []),
            })
        except (json.JSONDecodeError, OSError):
            result.append({"file": f.name, "timestamp": None})
    return result


def latest_backup_path():
    _ensure_dir()
    files = sorted(BACKUPS_DIR.glob("backup-*.json"), reverse=True)
    return files[0] if files else None


def restore_backup(filename):
    path = BACKUPS_DIR / Path(filename).name
    if not path.exists() or not path.name.startswith("backup-"):
        return {"ok": False, "error": "File backup không tồn tại"}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data.get("tasks"), list):
        return {"ok": False, "error": "Backup không hợp lệ"}
    TASKS_FILE.write_text(
        json.dumps(data["tasks"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if isinstance(data.get("events"), list) and data["events"]:
        EVENTS_FILE.write_text(
            json.dumps(data["events"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    create_backup(label="pre-restore")
    return {
        "ok": True,
        "restored": path.name,
        "tasks": len(data["tasks"]),
        "events": len(data.get("events") or []),
    }
