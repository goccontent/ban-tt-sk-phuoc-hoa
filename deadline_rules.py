"""Quy tắc deadline theo nhịp Trước / Trong / Sau."""
import re
from datetime import date, datetime, timedelta

TRUOC_DAYS_BEFORE = 2
TRUOC_TIME = (8, 0)       # 08:00 — hạn đăng thông báo
TRONG_TIME = (17, 30)     # trong ngày sự kiện
EVENT_END_TIME = (18, 0)  # giả định kết thúc sự kiện
SAU_HOURS_AFTER = 24
SOON_HOURS = 48


def parse_event_date_range(date_str):
    """
    Tách dải ngày từ chuỗi hiển thị, trả về (start, end) — đồng bộ với
    parseDateRangeFromDisplay() trong data.js.
      28.06.2026          -> start = end = 28.06.2026
      03–05.06.2026       -> start 03.06, end 05.06 (cùng tháng)
      03.06–03.07.2026    -> start 03.06, end 03.07 (khác tháng)
    """
    if not date_str:
        return None
    s = re.sub(r"\s", "", str(date_str))

    m = re.match(r"^(\d{1,2})[–\-](\d{1,2})\.(\d{1,2})\.(\d{4})$", s)
    if m:
        d1, d2, mo, y = (int(x) for x in m.groups())
        return date(y, mo, d1), date(y, mo, d2)

    m = re.match(r"^(\d{1,2})\.(\d{1,2})[–\-](\d{1,2})\.(\d{1,2})\.(\d{4})$", s)
    if m:
        d1, mo1, d2, mo2, y = (int(x) for x in m.groups())
        return date(y, mo1, d1), date(y, mo2, d2)

    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", s)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        return date(y, mo, d), date(y, mo, d)
    return None


def parse_event_date_iso(date_str):
    """Lấy ngày đầu (bắt đầu) từ chuỗi hiển thị: 28.06.2026 hoặc 03.06–03.07.2026."""
    rng = parse_event_date_range(date_str)
    return rng[0] if rng else None


def calc_deadline_for_phase(event_date_iso, phase, event_end_iso=None):
    """
    Trước: 2 ngày trước ngày bắt đầu, 08:00
    Trong: ngày bắt đầu, 17:30
    Sau: +24h sau 18:00 NGÀY KẾT THÚC (event_end_iso); nếu không truyền thì
         dùng ngày bắt đầu. Đồng bộ với calcDeadlineForPhase() trong data.js.
    """
    def _to_date(value):
        if isinstance(value, str):
            return datetime.strptime(value[:10], "%Y-%m-%d").date()
        return value

    start = _to_date(event_date_iso)
    end = _to_date(event_end_iso) if event_end_iso else start

    if phase == "Trước":
        d = start - timedelta(days=TRUOC_DAYS_BEFORE)
        return datetime(d.year, d.month, d.day, *TRUOC_TIME)
    if phase == "Trong":
        return datetime(start.year, start.month, start.day, *TRONG_TIME)
    if phase == "Sau":
        end_dt = datetime(end.year, end.month, end.day, *EVENT_END_TIME)
        return end_dt + timedelta(hours=SAU_HOURS_AFTER)
    return datetime(start.year, start.month, start.day, *TRUOC_TIME)


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
