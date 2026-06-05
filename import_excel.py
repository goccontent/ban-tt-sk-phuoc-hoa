"""
Đọc file Excel kế hoạch sự kiện.
Cột bắt buộc: Ngày + Sự kiện/Chương trình (tự nhận diện tên cột).
"""
import re
from datetime import date, datetime

from openpyxl import load_workbook

DATE_HEADERS = ("ngày", "ngay", "date", "thời gian", "thoi gian")
NAME_HEADERS = (
    "sự kiện", "su kien", "chương trình", "chuong trinh",
    "lễ", "le", "tên sự kiện", "ten su kien", "nội dung", "noi dung",
    "sự kiện / chương trình", "su kien / chuong trinh",
)


def _norm(s):
    if s is None:
        return ""
    return str(s).strip().lower()


def _find_columns(header_row):
    date_col = name_col = None
    for idx, cell in enumerate(header_row):
        h = _norm(cell)
        if not h:
            continue
        if date_col is None and any(k in h for k in DATE_HEADERS):
            date_col = idx
        if name_col is None and any(k in h for k in NAME_HEADERS):
            name_col = idx
    return date_col, name_col


def _parse_date_cell(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    s = str(value).strip()
    # 15.03.2026 hoặc 15/03/2026
    m = re.match(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if m:
        d, mo, y = m.groups()
        return f"{int(d):02d}.{int(mo):02d}.{y}"
    # 03.06–03.07.2026 hoặc 03.06-03.07.2026
    m = re.match(
        r"(\d{1,2})[./](\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})[./](\d{4})",
        s,
    )
    if m:
        d1, m1, d2, m2, y = m.groups()
        return f"{int(d1):02d}.{int(m1):02d}–{int(d2):02d}.{int(m2):02d}.{y}"
    return s


def parse_excel(file_path_or_stream):
    wb = load_workbook(file_path_or_stream, read_only=True, data_only=True)
    imported = []
    errors = []

    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        header_idx = None
        date_col = name_col = None
        for i, row in enumerate(rows[:10]):
            dc, nc = _find_columns(row)
            if dc is not None and nc is not None:
                header_idx = i
                date_col, name_col = dc, nc
                break

        if header_idx is None:
            errors.append(f"Sheet '{sheet.title}': không tìm thấy cột Ngày và Sự kiện")
            continue

        for row in rows[header_idx + 1 :]:
            if not row or all(c is None or str(c).strip() == "" for c in row):
                continue
            name = row[name_col] if name_col < len(row) else None
            raw_date = row[date_col] if date_col < len(row) else None
            name = str(name).strip() if name else ""
            date_str = _parse_date_cell(raw_date)
            if not name:
                continue
            if not date_str:
                errors.append(f"Bỏ qua '{name}': thiếu ngày")
                continue
            imported.append({
                "name": name,
                "date": date_str,
                "sheet": sheet.title,
            })

    wb.close()
    return imported, errors


def to_event_records(parsed_rows, existing_ids=None):
    from deadline_rules import parse_event_date_iso  # noqa: PLC0415
    from events_store import make_event_id  # noqa: PLC0415

    existing_ids = set(existing_ids or [])
    events = []
    for row in parsed_rows:
        eid = make_event_id(row["name"], row["date"], existing_ids | {e["id"] for e in events})
        ev_date = parse_event_date_iso(row["date"])
        rec = {
            "id": eid,
            "name": row["name"],
            "date": row["date"],
        }
        if ev_date:
            rec["eventDate"] = ev_date.isoformat()
        events.append(rec)
    return events
