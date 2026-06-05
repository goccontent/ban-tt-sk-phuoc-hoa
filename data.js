const DEFAULT_MEMBERS = [
  'Khánh Huyền', 'Minh', 'Trọng', 'Kiều Duyên',
  'Gioakim', 'CTV A', 'CTV B', 'CTV C'
];

let MEMBERS = [...DEFAULT_MEMBERS];

const STATUS_LABELS = {
  'chua-lam': 'Chưa làm',
  'dang-lam': 'Đang làm',
  'cho-duyet': 'Chờ duyệt',
  'da-dang': 'Đã xong'
};

let EVENTS = [
  { id: 'thi-giao-ly', name: 'Thi Giáo lý HK II & Lễ Chúa Thăng Thiên', date: '16–17.05.2026' },
  { id: 'so-ket-lop', name: 'Sơ kết tại lớp', date: '24.05.2026' },
  { id: 'he-2026', name: 'Chương trình Hè 2026', date: '03.06–03.07.2026' },
  { id: 'be-giang', name: 'Lễ Bế Giảng Năm Học Giáo Lý 2025-2026', date: '29–31.05.2026' },
  { id: 'quoc-te-thieu-nhi', name: 'Quốc Tế Thiếu Nhi', date: '01.06.2026' },
  { id: 'khai-mac-khoa', name: 'Khai mạc Khóa Đào Tạo Kỹ Năng TĐĐT', date: '02.06.2026' },
  { id: 'khoa-huan-luyen', name: 'Khóa Bồi dưỡng TT-CG (06.06)', date: '06.06.2026' },
  { id: 'ruoc-le-lan-dau', name: 'Lãnh nhận Bí Tích Rước Lễ Lần Đầu', date: '25–28.06.2026' },
  { id: 'them-suc', name: 'Lãnh nhận Bí Tích Thêm Sức', date: '04–07.07.2026' }
];

async function loadEvents() {
  if (!useServer) return EVENTS;
  try {
    const data = await apiFetch('/api/events');
    if (Array.isArray(data) && data.length) {
      EVENTS = data;
      localStorage.setItem('ban-tt-sk-events', JSON.stringify(EVENTS));
    }
  } catch {
    const saved = localStorage.getItem('ban-tt-sk-events');
    if (saved) try { EVENTS = JSON.parse(saved); } catch { /* keep default */ }
  }
  return EVENTS;
}

const STORAGE_KEY = 'ban-tt-sk-tasks';
const STORAGE_USER_KEY = 'ban-tt-sk-user';
const STORAGE_MEMBERS_KEY = 'ban-tt-sk-members';
const API_BASE = '';

let useServer = false;

const APP_PIN_KEY = 'ban-tt-sk-app-pin';

async function apiFetch(path, opts = {}) {
  const appPin = sessionStorage.getItem(APP_PIN_KEY);
  const res = await fetch(API_BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(appPin ? { 'X-App-Pin': appPin } : {}),
      ...opts.headers,
    },
    ...opts
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function checkServer() {
  try {
    await apiFetch('/api/tasks');
    useServer = true;
    return true;
  } catch {
    useServer = false;
    return false;
  }
}

async function loadMembers() {
  const saved = localStorage.getItem(STORAGE_MEMBERS_KEY);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) MEMBERS = arr;
    } catch { /* ignore */ }
  }

  if (!useServer) return MEMBERS;
  try {
    const res = await apiFetch('/api/members');
    if (Array.isArray(res) && res.length) {
      MEMBERS = res;
      localStorage.setItem(STORAGE_MEMBERS_KEY, JSON.stringify(MEMBERS));
    }
  } catch { /* ignore */ }
  return MEMBERS;
}

async function persistMembers(members) {
  MEMBERS = members;
  localStorage.setItem(STORAGE_MEMBERS_KEY, JSON.stringify(MEMBERS));
  if (useServer) {
    await apiFetch('/api/members', { method: 'PUT', body: JSON.stringify(MEMBERS) });
  }
}

async function loadTasks() {
  if (useServer) {
    try { return await apiFetch('/api/tasks'); } catch { /* fallback */ }
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  return [];
}

async function persistTasks(tasks) {
  if (useServer) {
    await apiFetch('/api/tasks', { method: 'PUT', body: JSON.stringify(tasks) });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// Chỉ đổi trạng thái MỘT việc — không cần mã ghi (mỗi người tự cập nhật việc mình).
async function persistTaskStatus(id, status, tasksRef) {
  if (useServer) {
    await apiFetch(`/api/tasks/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }
  if (Array.isArray(tasksRef)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasksRef));
  }
}

function getEvent(id) {
  return EVENTS.find(e => e.id === id);
}

function banClass(ban) {
  const map = { 'Nội dung': 'ban-noi-dung', 'Kỹ thuật': 'ban-ky-thuat', 'Quản trị': 'ban-quan-tri' };
  return map[ban] || '';
}

const PHASE_RULES = {
  'Trước': '2 ngày trước sự kiện · hạn 08:00',
  'Trong': 'Trong ngày sự kiện · hạn 17:30',
  'Sau': 'Trong 24h sau sự kiện (từ 18:00)'
};

function parseDateRangeFromDisplay(dateStr) {
  const s = (dateStr || '').replace(/\s/g, '');
  let m = s.match(/^(\d{1,2})[–\-](\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d1, d2, mo, y] = m;
    return {
      startISO: `${y}-${mo.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      endISO: `${y}-${mo.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})[–\-](\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d1, mo1, d2, mo2, y] = m;
    return {
      startISO: `${y}-${mo1.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      endISO: `${y}-${mo2.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return { startISO: iso, endISO: iso };
  }
  return null;
}

function parseEventDateRange(event) {
  if (!event) return null;
  if (event.eventDate) {
    const endISO = event.eventDate.slice(0, 10);
    let startISO = endISO;
    if (event.eventStartDate) {
      startISO = event.eventStartDate.slice(0, 10);
    } else {
      const parsed = parseDateRangeFromDisplay(event.date);
      if (parsed) startISO = parsed.startISO;
    }
    return { startISO, endISO };
  }
  return parseDateRangeFromDisplay(event.date);
}

function parseEventDateISO(event) {
  const range = parseEventDateRange(event);
  return range ? range.startISO : null;
}

function eventBracketDate(ev) {
  if (!ev) return '';
  const s = (ev.date || '').replace(/\s/g, '');
  const single = s.match(/^(\d{1,2}\.\d{1,2}\.\d{4})$/);
  if (single) return single[1];
  const first = (ev.date || '').match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
  if (first) return first[1];
  const range = parseEventDateRange(ev);
  if (range?.startISO) {
    const [y, mo, d] = range.startISO.split('-');
    return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y}`;
  }
  return '';
}

function formatEventLabel(ev) {
  if (!ev) return '';
  const d = eventBracketDate(ev);
  return d ? `${ev.name} [${d}]` : ev.name;
}

// Mô tả thời điểm diễn ra sự kiện cho người nhận việc:
// "Thứ 4, 06.06.2026 lúc 10:00" hoặc "03.06.2026 → 03.07.2026 lúc 10:00"
function eventWhenText(ev) {
  const range = parseEventDateRange(ev);
  if (!range) return '';
  const startD = isoToDisplayDate(range.startISO);
  let when;
  if (range.endISO && range.endISO !== range.startISO) {
    when = `${startD} → ${isoToDisplayDate(range.endISO)}`;
  } else {
    const d = new Date(range.startISO + 'T00:00:00');
    when = `${weekdayVi(d)}, ${startD}`;
  }
  const t = /^\d{1,2}:\d{2}$/.test(ev?.eventStartTime || '') ? ev.eventStartTime : '';
  return t ? `${when} lúc ${t}` : when;
}

function displayDateToISO(display) {
  const m = (display || '').match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function isoToDisplayDate(iso) {
  if (!iso) return '';
  const [y, mo, d] = iso.slice(0, 10).split('-');
  return `${d}.${mo}.${y}`;
}

function isEventPast(ev) {
  const range = parseEventDateRange(ev);
  if (!range) return false;
  return range.endISO < todayISO();
}

async function persistEvents(events) {
  if (useServer) {
    await apiFetch('/api/events', { method: 'PUT', body: JSON.stringify(events) });
  }
  localStorage.setItem('ban-tt-sk-events', JSON.stringify(events));
}

function classifyEvents(eventList) {
  const today = todayISO();
  const upcoming = [];
  const past = [];
  for (const ev of eventList) {
    const range = parseEventDateRange(ev) || { startISO: '9999-12-31', endISO: '9999-12-31' };
    const item = { ...ev, _range: range };
    if (range.endISO < today) past.push(item);
    else upcoming.push(item);
  }
  upcoming.sort((a, b) => a._range.startISO.localeCompare(b._range.startISO));
  past.sort((a, b) => b._range.endISO.localeCompare(a._range.endISO));
  return { upcoming, past };
}

function calcDeadlineForPhase(eventId, phase) {
  const ev = getEvent(eventId);
  const range = parseEventDateRange(ev);
  if (!range) return null;

  // "Trước" và "Trong" neo theo ngày bắt đầu; "Sau" neo theo ngày kết thúc
  // (sự kiện nhiều ngày: hạn "Sau" phải tính từ ngày cuối, không phải ngày đầu).
  const [sy, smo, sd] = range.startISO.split('-').map(Number);

  if (phase === 'Trước') {
    const base = new Date(sy, smo - 1, sd);
    base.setDate(base.getDate() - 2);
    return toDeadlineISO(base, '08:00');
  }
  if (phase === 'Trong') {
    // Giờ bắt đầu sự kiện (nếu có) → deadline nhịp "Trong"; không thì 17:30
    const t = /^\d{1,2}:\d{2}$/.test(ev?.eventStartTime || '') ? ev.eventStartTime : '17:30';
    return toDeadlineISO(new Date(sy, smo - 1, sd), t);
  }
  if (phase === 'Sau') {
    const [ey, emo, ed] = range.endISO.split('-').map(Number);
    const end = new Date(ey, emo - 1, ed, 18, 0, 0);
    end.setTime(end.getTime() + 24 * 3600000);
    const hh = String(end.getHours()).padStart(2, '0');
    const mm = String(end.getMinutes()).padStart(2, '0');
    return toDeadlineISO(end, `${hh}:${mm}`);
  }
  return null;
}

function toDeadlineISO(date, time) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${time}`;
}

function normalizeDeadline(dl) {
  if (!dl) return dl;
  if (dl.includes('T')) return dl.slice(0, 16);
  return `${dl}T08:00`;
}

function splitDeadline(dl) {
  const n = normalizeDeadline(dl);
  const [date, time = '08:00'] = n.split('T');
  return { date, time };
}

function formatDate(dateStr) {
  const part = (dateStr || '').slice(0, 10);
  const d = new Date(part + 'T00:00:00');
  const days = ['CN', 'T.2', 'T.3', 'T.4', 'T.5', 'T.6', 'T.7'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${days[d.getDay()]} ${dd}.${mm}`;
}

function formatDeadline(dl) {
  const { date, time } = splitDeadline(dl);
  return `${formatDate(date)} ${time}`;
}

// Thứ trong tuần đầy đủ: 0=Chủ Nhật, 1=Thứ 2 … 6=Thứ 7
function weekdayVi(d) {
  return d.getDay() === 0 ? 'Chủ Nhật' : `Thứ ${d.getDay() + 1}`;
}

// "Vào 10:00 - Thứ 4 (03.06.2026)"
function formatDeadlineFull(dl) {
  const { date, time } = splitDeadline(dl);
  const part = (date || '').slice(0, 10);
  const d = new Date(part + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `Vào ${time} - ${weekdayVi(d)} (${dd}.${mm}.${yyyy})`;
}

// Nhãn nhịp đầy đủ: "Trước" → "Trước sự kiện"
const PHASE_LABELS = { 'Trước': 'Trước sự kiện', 'Trong': 'Trong sự kiện', 'Sau': 'Sau sự kiện' };
function phaseLabel(phase) {
  return PHASE_LABELS[phase] || phase || '';
}

function parseDeadlineDate(dl) {
  const { date, time } = splitDeadline(dl);
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm || 0, 0);
}

const SOON_HOURS = 48;

function deadlineAlert(deadline, status) {
  if (status === 'da-dang') return { level: '', text: '' };
  const diffH = (parseDeadlineDate(deadline) - new Date()) / 3600000;
  if (diffH < 0) return { level: 'overdue', text: 'QUÁ HẠN' };
  if (diffH <= SOON_HOURS) return { level: 'soon', text: 'GẦN ĐẾN HẠN' };
  return { level: '', text: '' };
}

function deadlineClass(deadline, status) {
  return deadlineAlert(deadline, status).level;
}

function alertBadgeHTML(deadline, status) {
  const a = deadlineAlert(deadline, status);
  if (!a.text) return '';
  return `<span class="alert-badge alert-${a.level}">${a.text}</span>`;
}

function formatCountdown(deadline, status) {
  if (status === 'da-dang') return { text: '', overdue: false, done: true, live: false };
  const ms = parseDeadlineDate(deadline) - new Date();
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const sec = Math.floor(abs / 1000) % 60;
  const min = Math.floor(abs / 60000) % 60;
  const hr = Math.floor(abs / 3600000) % 24;
  const day = Math.floor(abs / 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(hr)}:${pad(min)}:${pad(sec)}`;
  // Quá hạn: vẫn chạy đồng hồ để thấy độ trễ
  if (overdue) {
    const text = day > 0 ? `Trễ ${day} ngày ${clock}` : `Trễ ${clock}`;
    return { text, overdue: true, done: false, live: true };
  }
  // Còn xa → đếm tuần (≥14 ngày); gần hơn → đếm ngày (1–13 ngày);
  // dưới 24 giờ → chạy đồng hồ đếm ngược theo giây.
  if (day >= 14) {
    const weeks = Math.round(day / 7);
    return { text: `Còn ${weeks} tuần nữa`, overdue: false, done: false, live: false };
  }
  if (day >= 1) {
    return { text: `Còn ${day} ngày nữa`, overdue: false, done: false, live: false };
  }
  return { text: `Còn ${clock}`, overdue: false, done: false, live: true };
}

function shouldShowCountdown(deadline, status) {
  return status !== 'da-dang';
}

function countdownHTML(deadline, status, taskId = '') {
  if (!shouldShowCountdown(deadline, status)) return '';
  const dlClass = deadlineClass(deadline, status);
  const { text, live } = formatCountdown(deadline, status);
  const icon = live ? '⏱' : '🗓';
  return `<div class="countdown-clock ${dlClass}${live ? '' : ' countdown-far'}" data-countdown data-deadline="${deadline}" data-status="${status}"${taskId ? ` data-task-id="${taskId}"` : ''}>
    <span class="countdown-icon" aria-hidden="true">${icon}</span>
    <span class="countdown-text">${text}</span>
  </div>`;
}

function migrateTasksDeadlines(taskList) {
  return taskList.map(t => ({
    ...t,
    deadline: normalizeDeadline(t.deadline)
  }));
}

function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
