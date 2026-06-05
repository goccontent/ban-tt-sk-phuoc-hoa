"""Lưu / đọc danh sách thành viên."""
import json
from pathlib import Path

BASE = Path(__file__).parent
MEMBERS_FILE = BASE / "members.json"

DEFAULT_MEMBERS = [
    "Khánh Huyền", "Minh", "Trọng", "Kiều Duyên",
    "Gioakim", "CTV A", "CTV B", "CTV C",
]


def load_members():
    if MEMBERS_FILE.exists():
        try:
            data = json.loads(MEMBERS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return [str(x).strip() for x in data if str(x).strip()]
        except json.JSONDecodeError:
            pass
    save_members(DEFAULT_MEMBERS)
    return list(DEFAULT_MEMBERS)


def save_members(members):
    cleaned = []
    seen = set()
    for m in members or []:
        s = str(m).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(s)
    if not cleaned:
        cleaned = list(DEFAULT_MEMBERS)
    MEMBERS_FILE.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    return cleaned


def add_member(name):
    name = str(name or "").strip()
    if not name:
        return None
    members = load_members()
    if name.lower() not in {m.lower() for m in members}:
        members.append(name)
        members = save_members(members)
    return members

