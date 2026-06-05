"""Lưu / đọc danh sách sự kiện."""
import json
import re
import unicodedata
from pathlib import Path

_DATE_RE = re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{4})")

BASE = Path(__file__).parent
EVENTS_FILE = BASE / "events.json"


def _default_events():
    from data_events import EVENTS  # noqa: PLC0415
    return list(EVENTS)


def parse_event_date_iso(date_str):
    """Lấy ngày đầu tiên từ chuỗi hiển thị (VD: 28.06.2026 hoặc 03.06–03.07.2026)."""
    if not date_str:
        return None
    m = _DATE_RE.search(str(date_str))
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def enrich_event(ev):
    if not ev.get("eventDate"):
        iso = parse_event_date_iso(ev.get("date", ""))
        if iso:
            ev["eventDate"] = iso
    return ev


def load_events():
    if EVENTS_FILE.exists():
        try:
            data = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return [enrich_event(e) for e in data]
        except json.JSONDecodeError:
            pass
    events = [enrich_event(e) for e in _default_events()]
    save_events(events)
    return events


def save_events(events):
    EVENTS_FILE.write_text(
        json.dumps(events, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def slugify(text):
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return text or "su-kien"


def make_event_id(name, date_str, existing_ids):
    base = slugify(name)[:40]
    candidate = base
    n = 1
    while candidate in existing_ids:
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def merge_events(existing, imported, replace=False):
    if replace:
        return imported
    by_key = {(e["name"].strip().lower(), e["date"]): e for e in existing}
    for ev in imported:
        key = (ev["name"].strip().lower(), ev["date"])
        if key not in by_key:
            by_key[key] = ev
    return list(by_key.values())
