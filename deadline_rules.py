"""Quy tắc deadline theo nhịp Trước / Trong / Sau."""
import re
from datetime import date, datetime, timedelta

TRUOC_DAYS_BEFORE = 2
TRUOC_TIME = (8, 0)       # 08:00 — hạn đăng thông báo
TRONG_TIME = (17, 30)     # trong ngày sự kiện
EVENT_END_TIME = (18, 0)  # giả định kết thúc sự kiện
SAU_HOURS_AFTER = 24
SOON_HOURS = 48


def parse_event_date_iso(date_str):
    """Lấy ngày đầu từ chuỗi hiển thị: 28.06.2026 hoặc 03.06–03.07.2026."""
    if not date_str:
        return None
    m = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", str(date_str))
    if not m:
        return None
    d, mo, y = m.groups()
    return date(int(y), int(mo), int(d))


def calc_deadline_for_phase(event_date_iso, phase):
    """
    Trước: 2 ngày trước sự kiện, 08:00
    Trong: ngày sự kiện, 17:30
    Sau: +24h sau 18:00 ngày sự kiện
    """
    if isinstance(event_date_iso, str):
        ev = datetime.strptime(event_date_iso[:10], "%Y-%m-%d").date()
    else:
        ev = event_date_iso

    if phase == "Trước":
        d = ev - timedelta(days=TRUOC_DAYS_BEFORE)
        return datetime(d.year, d.month, d.day, *TRUOC_TIME)
    if phase == "Trong":
        return datetime(ev.year, ev.month, ev.day, *TRONG_TIME)
    if phase == "Sau":
        end = datetime(ev.year, ev.month, ev.day, *EVENT_END_TIME)
        return end + timedelta(hours=SAU_HOURS_AFTER)
    return datetime(ev.year, ev.month, ev.day, *TRUOC_TIME)


def deadline_to_iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M")


def normalize_deadline(deadline_str):
    if not deadline_str:
        return deadline_str
    if "T" in deadline_str:
        return deadline_str[:16]
    return f"{deadline_str}T08:00"


def parse_deadline(deadline_str):
    s = normalize_deadline(deadline_str)
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M")
    except ValueError:
        return datetime.strptime(s[:10], "%Y-%m-%d")


def deadline_alert_level(deadline_str, now=None, done=False):
    if done:
        return None, ""
    if now is None:
        now = datetime.now()
    dl = parse_deadline(deadline_str)
    diff_h = (dl - now).total_seconds() / 3600
    if diff_h < 0:
        return "overdue", "QUÁ HẠN"
    if diff_h <= SOON_HOURS:
        return "soon", "GẦN ĐẾN HẠN"
    return None, ""


def format_deadline_vi(deadline_str):
    dt = parse_deadline(deadline_str)
    py_days = ["T.2", "T.3", "T.4", "T.5", "T.6", "T.7", "CN"]
    wd = py_days[dt.weekday()]
    return f"{wd} {dt.day:02d}.{dt.month:02d} {dt.strftime('%H:%M')}"
