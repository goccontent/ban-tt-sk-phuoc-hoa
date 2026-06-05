const MEMBERS = [
  'Khánh Huyền', 'Minh', 'Trọng', 'Kiều Duyên',
  'Gioakim', 'CTV A', 'CTV B', 'CTV C'
];

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
const API_BASE = '';

let useServer = false;

async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
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

function parseEventDateISO(event) {
  if (event?.eventDate) return event.eventDate.slice(0, 10);
  const m = (event?.date || '').match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function calcDeadlineForPhase(eventId, phase) {
  const ev = getEvent(eventId);
  const iso = parseEventDateISO(ev);
  if (!iso) return null;
  const [y, mo, d] = iso.split('-').map(Number);
  const base = new Date(y, mo - 1, d);

  if (phase === 'Trước') {
    base.setDate(base.getDate() - 2);
    return toDeadlineISO(base, '08:00');
  }
  if (phase === 'Trong') {
    return toDeadlineISO(base, '17:30');
  }
  if (phase === 'Sau') {
    const end = new Date(y, mo - 1, d, 18, 0, 0);
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
  if (status === 'da-dang') return { text: '', overdue: false, done: true };
  const ms = parseDeadlineDate(deadline) - new Date();
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const sec = Math.floor(abs / 1000) % 60;
  const min = Math.floor(abs / 60000) % 60;
  const hr = Math.floor(abs / 3600000) % 24;
  const day = Math.floor(abs / 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(hr)}:${pad(min)}:${pad(sec)}`;
  let text;
  if (overdue) {
    text = day > 0 ? `Trễ ${day} ngày ${clock}` : `Trễ ${clock}`;
  } else {
    text = day > 0 ? `Còn ${day} ngày ${clock}` : `Còn ${clock}`;
  }
  return { text, overdue, done: false };
}

function countdownHTML(deadline, status, taskId = '') {
  if (status === 'da-dang') return '';
  const dlClass = deadlineClass(deadline, status);
  const { text } = formatCountdown(deadline, status);
  return `<div class="countdown-clock ${dlClass}" data-countdown data-deadline="${deadline}" data-status="${status}"${taskId ? ` data-task-id="${taskId}"` : ''}>
    <span class="countdown-icon" aria-hidden="true">⏱</span>
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
