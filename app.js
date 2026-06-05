let tasks = [];
let editingId = null;
let countdownTimer = null;
const ADMIN_SESSION_KEY = 'ban-tt-sk-admin-pin';
let eventSectionState = { upcoming: true, past: false };
let eventOpenState = {};
const STORAGE_VIEW_KEY = 'ban-tt-sk-view';
let viewMode = localStorage.getItem(STORAGE_VIEW_KEY) || 'all';

// --- Quản trị (admin) ---
const ADMIN_NAME = 'Trọng';
const ADMIN_PASSWORD = 'Trong@12345';
const ADMIN_AUTH_KEY = 'ban-tt-sk-admin-authed';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function adminHeaders() {
  const pin = sessionStorage.getItem(ADMIN_SESSION_KEY);
  return pin ? { 'X-Admin-Pin': pin } : {};
}

// Admin = đã chọn "Trọng" ở ô "Tôi là" VÀ đã đăng nhập đúng mật mã trong phiên này.
function isAdminActive() {
  return $('#my-name')?.value === ADMIN_NAME && sessionStorage.getItem(ADMIN_AUTH_KEY) === '1';
}

function promptAdminLogin() {
  if (sessionStorage.getItem(ADMIN_AUTH_KEY) === '1') return true;
  for (let i = 0; i < 3; i++) {
    const p = prompt(`Đăng nhập quản trị — ${ADMIN_NAME}\nNhập mật mã:`);
    if (p === null) return false;
    if (p === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_AUTH_KEY, '1');
      // Dùng luôn mật mã này làm mã ghi gửi lên server (nếu server có bật APP_WRITE_PIN)
      sessionStorage.setItem(APP_PIN_KEY, p);
      return true;
    }
    alert('Mật mã không đúng. Thử lại.');
  }
  return false;
}

// Hiện/ẩn các nút chỉ dành cho admin (qua class body.not-admin trong CSS)
function applyAdminUI() {
  const admin = isAdminActive();
  document.body.classList.toggle('not-admin', !admin);
  if (!admin) {
    const botTab = document.querySelector('.tab[data-tab="bot"]');
    if (botTab?.classList.contains('active')) switchToTab('all');
  }
  updateMemberReminderButton();
}

function switchToTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

async function init() {
  await checkServer();
  await loadMembers();
  await loadEvents();
  const loaded = await loadTasks();
  tasks = migrateTasksDeadlines(loaded);
  if (useServer && JSON.stringify(loaded) !== JSON.stringify(tasks)) {
    await tryPersist(tasks);
  }

  populateSelects();
  bindEvents();
  // Mở app ở chế độ "việc chung": chưa chọn tên → xem Cả ban
  viewMode = 'all';
  applyAdminUI();
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));
  renderAll();
  startCountdownTicker();

  if (useServer) {
    await loadTelegramConfig();
    await loadTelegramUsers();
    updateMemberReminderButton();
    showServerBadge();
  } else {
    $('#telegram-setup')?.classList.add('offline');
    $('#tg-status').innerHTML = '<p class="hint warn">Chạy <code>python server.py</code> để dùng Telegram thật. Hiện dùng localStorage.</p>';
  }
}

function showServerBadge() {
  const el = document.createElement('span');
  el.className = 'server-badge';
  el.textContent = '● Server';
  document.querySelector('.header-brand div')?.appendChild(el);
}

function populateSelects() {
  const eventOpts = EVENTS.map(e => `<option value="${e.id}">${formatEventLabel(e)}</option>`).join('');
  $('#task-event').innerHTML = eventOpts;
  const filterEventOpts = EVENTS.map(e => `<option value="${e.id}">${formatEventLabel(e)}</option>`).join('');
  $('#filter-event').innerHTML = '<option value="">Tất cả sự kiện</option>' + filterEventOpts;

  const memberOpts = MEMBERS.map(m => `<option value="${m}">${m}</option>`).join('');
  $('#task-owner').innerHTML = memberOpts;
  $('#task-helper').innerHTML = MEMBERS.map(m =>
    `<label class="checkbox-item"><input type="checkbox" value="${m}"> ${m}</label>`
  ).join('');
  // Giữ lựa chọn hiện tại khi nạp lại danh sách giữa phiên; mặc định mở app là "— Chọn —"
  const cur = $('#my-name').value;
  $('#my-name').innerHTML = '<option value="">— Chọn —</option>' + memberOpts;
  if (cur) $('#my-name').value = cur;
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem(STORAGE_VIEW_KEY, mode);
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
  if (mode === 'mine' && !$('#my-name').value) {
    $('#mine-reminder-status').innerHTML = '<span class="hint warn">Chọn tên ở góc trên để xem việc của bạn</span>';
  } else {
    $('#mine-reminder-status').innerHTML = '';
  }
  updateWorkView();
}

function getActiveTasks() {
  return tasks.filter((t) => !t.deletedAt);
}

function getTrashedTasks() {
  return tasks.filter((t) => t.deletedAt).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
}

function getFilteredTasks() {
  let list = getActiveTasks();
  const me = $('#my-name')?.value;
  if (viewMode === 'mine' && me) {
    list = list.filter((t) => t.owner === me || (t.helpers || []).includes(me));
  }
  const ban = $('#filter-ban')?.value;
  if (ban) list = list.filter((t) => t.ban === ban);
  const evId = $('#filter-event')?.value;
  if (evId) list = list.filter((t) => t.eventId === evId);
  return list;
}

function bindEvents() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'bot' && !isAdminActive()) {
        alert(`Chỉ quản trị (${ADMIN_NAME}) mới mở được "Bot nhắc".\nChọn "${ADMIN_NAME}" ở ô "Tôi là" và đăng nhập.`);
        return;
      }
      switchToTab(tab.dataset.tab);
      if (tab.dataset.tab === 'bot' && useServer) loadTelegramUsers();
    });
  });

  $('#btn-add-task').addEventListener('click', () => openModal());
  $('#btn-add-event')?.addEventListener('click', openEventModal);
  $('#btn-close-event-modal')?.addEventListener('click', closeEventModal);
  $('#btn-cancel-event')?.addEventListener('click', closeEventModal);
  $('#event-form')?.addEventListener('submit', saveEvent);
  $('#event-date-input')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) {
      const [y, mo, d] = v.split('-');
      $('#event-date-display').value = `${d}.${mo}.${y}`;
    }
  });
  $('#btn-import-excel').addEventListener('click', () => $('#excel-file').click());
  $('#excel-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFromExcel(file);
    e.target.value = '';
  });
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#task-form').addEventListener('submit', saveTask);

  $$('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });
  $('#filter-ban').addEventListener('change', () => updateWorkView());
  $('#filter-event')?.addEventListener('change', () => updateWorkView());
  $('#task-event').addEventListener('change', () => { updatePhaseHint(); applyDeadlineFromPhase(); });
  $('#task-phase').addEventListener('change', () => { updatePhaseHint(); applyDeadlineFromPhase(); });
  $('#my-name').addEventListener('change', (e) => {
    let name = e.target.value;
    // Chọn "Trọng" → yêu cầu đăng nhập quản trị
    if (name === ADMIN_NAME && !promptAdminLogin()) {
      e.target.value = '';
      name = '';
    }
    localStorage.setItem(STORAGE_USER_KEY, name);
    applyAdminUI();
    updateMemberReminderButton();
    if (name) {
      // Chọn tên cụ thể → chỉ hiện việc của người đó
      setViewMode('mine');
    } else {
      // Về "— Chọn —" → xem việc chung của cả ban
      setViewMode('all');
    }
  });
  $('#btn-backup')?.addEventListener('click', downloadBackup);
  $('#btn-add-member')?.addEventListener('click', openMemberModal);
  $('#btn-close-member-modal')?.addEventListener('click', closeMemberModal);
  $('#btn-cancel-member')?.addEventListener('click', closeMemberModal);
  $('#member-form')?.addEventListener('submit', saveMember);

  $('#btn-simulate-bot').addEventListener('click', () => previewReminders());
  $('#btn-tg-save')?.addEventListener('click', saveTelegramConfig);
  $('#btn-tg-save-public')?.addEventListener('click', saveTelegramConfigPublic);
  $('#btn-tg-test')?.addEventListener('click', testTelegram);
  $('#btn-tg-send')?.addEventListener('click', sendTelegramReminders);
  $('#btn-tg-webhook')?.addEventListener('click', setupTelegramWebhook);
  $('#btn-tg-admin')?.addEventListener('click', unlockTelegramAdmin);
}

function updateMemberReminderButton() {
  const btn = $('#btn-send-member-reminder');
  if (!btn) return;
  const name = $('#my-name').value;
  btn.disabled = !useServer || !name;
  btn.title = name ? `Gửi nhắc Telegram cho ${name}` : 'Chọn tên trước';
}

async function importFromExcel(file) {
  if (!useServer) {
    alert('Cần chạy server.py để import Excel.');
    return;
  }
  if (!confirm(`Import sự kiện từ file "${file.name}"?`)) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('replace', 'false');

  try {
    const res = await fetch('/api/events/import', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Import thất bại');
    }
    EVENTS = data.events;
    localStorage.setItem('ban-tt-sk-events', JSON.stringify(EVENTS));
    populateSelects();
    renderAll();
    let msg = `Đã import ${data.imported} sự kiện (tổng ${data.total}).`;
    if (data.parseErrors?.length) {
      msg += `\n\nLưu ý: ${data.parseErrors.length} dòng bỏ qua.`;
    }
    alert(msg);
  } catch (e) {
    alert('Lỗi import Excel: ' + e.message);
  }
}

async function syncTasks() {
  try {
    await persistTasks(tasks);
  } catch (e) {
    if (String(e.message || '').includes('write_locked')) {
      sessionStorage.removeItem(APP_PIN_KEY);
      sessionStorage.removeItem(ADMIN_AUTH_KEY);
      applyAdminUI();
      alert('Phiên quản trị hết hiệu lực. Chọn lại "Trọng" và đăng nhập để lưu.');
    } else {
      throw e;
    }
  }
}

// Lưu nhưng bỏ qua lỗi khóa ghi (dùng cho việc nền như migrate deadline)
async function tryPersist(data) {
  try {
    await persistTasks(data);
  } catch (e) {
    if (!String(e.message || '').includes('write_locked')) throw e;
  }
}

function renderAll() {
  renderAlertBanner();
  updateWorkView();
  renderTrash();
  renderEvents();
  tickCountdowns();
}

function updateWorkView() {
  // Cả ban lẫn "việc của tôi" đều dùng chung danh sách ưu tiên (gấp lên đầu)
  renderTaskList();
}

function openMemberModal() {
  $('#member-form').reset();
  $('#member-modal').showModal();
}

function closeMemberModal() {
  $('#member-modal').close();
}

async function saveMember(e) {
  e.preventDefault();
  const name = ($('#member-name')?.value || '').trim();
  if (!name) return;
  try {
    let saved = false;
    if (useServer) {
      try {
        const res = await apiFetch('/api/members', { method: 'POST', body: JSON.stringify({ name }) });
        MEMBERS = res.members || MEMBERS;
        localStorage.setItem('ban-tt-sk-members', JSON.stringify(MEMBERS));
        saved = true;
      } catch {
        saved = false;
      }
    }
    if (!saved) {
      if (!MEMBERS.some((m) => m.toLowerCase() === name.toLowerCase())) MEMBERS.push(name);
      localStorage.setItem('ban-tt-sk-members', JSON.stringify(MEMBERS));
    }
    populateSelects();
    $('#my-name').value = name;
    localStorage.setItem(STORAGE_USER_KEY, name);
    updateMemberReminderButton();
    closeMemberModal();
    setViewMode('mine');
  } catch (err) {
    alert('Lỗi thêm người: ' + err.message);
  }
}

async function downloadBackup() {
  if (!useServer) {
    const blob = new Blob([JSON.stringify({ tasks, events: EVENTS, timestamp: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-local-${todayISO()}.json`;
    a.click();
    return;
  }
  try {
    await apiFetch('/api/backup/create', { method: 'POST', body: '{}' });
    window.open('/api/backup/latest', '_blank');
  } catch (e) {
    alert('Lỗi backup: ' + e.message);
  }
}

function tickCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const { deadline, status } = el.dataset;
    const { text, overdue, done } = formatCountdown(deadline, status);
    if (done) return;
    const textEl = el.querySelector('.countdown-text');
    if (textEl) textEl.textContent = text;
    el.classList.remove('overdue', 'soon');
    if (overdue) el.classList.add('overdue');
    else if (deadlineClass(deadline, status) === 'soon') el.classList.add('soon');
  });
}

function startCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer);
  tickCountdowns();
  countdownTimer = setInterval(tickCountdowns, 1000);
}

function renderAlertBanner() {
  const banner = $('#alert-banner');
  if (!banner) return;
  let overdue = 0, soon = 0;
  getActiveTasks().forEach(t => {
    if (t.status === 'da-dang') return;
    const a = deadlineAlert(t.deadline, t.status);
    if (a.level === 'overdue') overdue++;
    else if (a.level === 'soon') soon++;
  });
  if (!overdue && !soon) {
    banner.className = 'alert-banner';
    banner.innerHTML = '';
    return;
  }
  const parts = [];
  if (overdue) parts.push(`<span class="alert-badge alert-overdue">${overdue} QUÁ HẠN</span>`);
  if (soon) parts.push(`<span class="alert-badge alert-soon">${soon} GẦN ĐẾN HẠN</span>`);
  banner.className = 'alert-banner visible ' + (overdue ? 'overdue-only' : 'mixed');
  banner.innerHTML = parts.join('') + '<span style="font-weight:500">— Cần xử lý sớm!</span>';
}

// Mức ưu tiên: quá hạn (0) → gần đến hạn (1) → bình thường (2) → đã xong (3)
function urgencyRank(t) {
  if (t.status === 'da-dang') return 3;
  const a = deadlineAlert(t.deadline, t.status);
  if (a.level === 'overdue') return 0;
  if (a.level === 'soon') return 1;
  return 2;
}

function sortTasksForBoard(list) {
  return [...list].sort((a, b) => {
    const ra = urgencyRank(a), rb = urgencyRank(b);
    if (ra !== rb) return ra - rb;
    return (a.deadline || '').localeCompare(b.deadline || '');
  });
}

function renderTaskList() {
  const container = $('#my-tasks');
  const me = $('#my-name').value;
  const mineMode = viewMode === 'mine';

  if (mineMode && !me) {
    container.innerHTML = '<div class="empty-state">Chọn tên ở ô <strong>Tôi là</strong> để xem việc của bạn</div>';
    return;
  }

  const list = sortTasksForBoard(getFilteredTasks());
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">${mineMode ? `Không có việc nào của ${me}` : 'Chưa có việc nào'}</div>`;
    return;
  }

  container.innerHTML = list.map(t => taskListItemHTML(t, me, mineMode)).join('');

  container.querySelectorAll('.my-task-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.task-actions')) return;
      if (!isAdminActive()) return; // chỉ admin mới sửa việc
      openModal(item.dataset.id);
    });
  });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isAdminActive()) return;
      const id = btn.closest('.my-task-item').dataset.id;
      const action = btn.dataset.action;
      if (action === 'next') advanceStatus(id);
      else if (action === 'delete') deleteTask(id);
      else if (action === 'remind') remindTask(id);
    });
  });
}

function taskListItemHTML(t, me, mineMode) {
  const ev = getEvent(t.eventId);
  const isOwner = t.owner === me;
  const dlClass = deadlineClass(t.deadline, t.status);
  const alertHtml = alertBadgeHTML(t.deadline, t.status);
  const nextStatus = getNextStatus(t.status);
  const helpers = t.helpers?.length ? t.helpers.join(', ') : '';
  const ownerLine = mineMode
    ? (isOwner ? '<strong>Chủ trì (bạn)</strong>' : `Chủ trì: ${t.owner}`)
    : `Chủ trì: <strong>${t.owner}</strong>`;
  const rank = urgencyRank(t);
  const urgent = rank === 0 || rank === 1; // quá hạn hoặc gần đến hạn
  return `
    <div class="my-task-item ${isOwner && mineMode ? 'chinh' : ''} ${dlClass}" data-id="${t.id}">
      <div class="task-main">
        ${alertHtml}
        <div class="task-phase">${t.phase} · ${ev?.name || ''} · ${t.ban}</div>
        <div class="task-desc" style="margin:0.35rem 0">${t.desc}</div>
        <div class="task-meta">
          ${ownerLine}${helpers ? ` · PH: ${helpers}` : ''}
        </div>
        <div class="task-deadline ${dlClass}">Hạn: ${formatDeadline(t.deadline)}</div>
        ${countdownHTML(t.deadline, t.status, t.id)}
      </div>
      <div class="task-side">
        <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status]}</span>
        <div class="task-actions">
          ${urgent ? `<button class="btn btn-sm btn-warn" data-action="remind" title="Nhắc Chủ trì + Phối hợp qua Telegram">📱 Nhắc</button>` : ''}
          ${nextStatus ? `<button class="btn btn-sm btn-secondary" data-action="next">→ ${STATUS_LABELS[nextStatus]}</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="delete" title="Chuyển vào thùng rác">🗑</button>
        </div>
      </div>
    </div>`;
}

function getNextStatus(current) {
  const flow = ['chua-lam', 'dang-lam', 'cho-duyet', 'da-dang'];
  const i = flow.indexOf(current);
  return i < flow.length - 1 ? flow[i + 1] : null;
}

async function advanceStatus(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const next = getNextStatus(t.status);
  if (next) {
    t.status = next;
    await syncTasks();
    renderAll();
  }
}

async function deleteTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t || !confirm('Chuyển việc vào thùng rác?')) return;
  t.deletedAt = new Date().toISOString();
  await syncTasks();
  renderAll();
}

async function restoreTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  delete t.deletedAt;
  await syncTasks();
  renderAll();
}

async function purgeTask(id) {
  if (!confirm('Xóa vĩnh viễn? Không khôi phục được.')) return;
  tasks = tasks.filter((t) => t.id !== id);
  await syncTasks();
  renderAll();
}

function renderTrash() {
  const trashed = getTrashedTasks();
  const countEl = $('#trash-count');
  if (countEl) countEl.textContent = trashed.length;
  const list = $('#trash-list');
  if (!list) return;
  if (!trashed.length) {
    list.innerHTML = '<p class="hint">Thùng rác trống</p>';
    return;
  }
  list.innerHTML = trashed.map((t) => `
    <div class="trash-item">
      <div class="trash-item-info">
        <strong>${t.owner}</strong> · ${t.desc.slice(0, 80)}${t.desc.length > 80 ? '…' : ''}
        <span class="hint"> · ${formatDeadline(t.deadline)}</span>
      </div>
      <div class="trash-item-actions">
        <button type="button" class="btn btn-sm btn-secondary" data-restore="${t.id}">Khôi phục</button>
        <button type="button" class="btn btn-sm btn-ghost" data-purge="${t.id}">Xóa hẳn</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', () => restoreTask(btn.dataset.restore));
  });
  list.querySelectorAll('[data-purge]').forEach((btn) => {
    btn.addEventListener('click', () => purgeTask(btn.dataset.purge));
  });
}

function eventCardHTML(ev, isPast = false) {
  const evTasks = getActiveTasks().filter(t => t.eventId === ev.id);
  const isOpen = !!eventOpenState[ev.id];
  const rows = evTasks.length ? evTasks.map(t => `
      <div class="event-task-row" data-task-id="${t.id}">
        <span data-label="Nhịp">${t.phase}</span>
        <span data-label="Đầu việc">${t.desc}</span>
        <span data-label="Chủ trì">${t.owner}</span>
        <span data-label="Phối hợp">${t.helpers?.join(', ') || '—'}</span>
        <span class="deadline-cell" data-label="Hạn">
          <span>${formatDeadline(t.deadline)}</span>
          ${countdownHTML(t.deadline, t.status, t.id)}
        </span>
        <span class="status-badge status-${t.status}" data-label="Trạng thái">${STATUS_LABELS[t.status]}</span>
      </div>`).join('') : '<p class="event-empty-tasks">Chưa có đầu việc</p>';

  return `
    <div class="event-accordion ${isOpen ? 'open' : ''}" data-event-id="${ev.id}">
      <div class="event-accordion-header">
        <button type="button" class="event-accordion-toggle" data-event-toggle="${ev.id}" aria-expanded="${isOpen}">
          <span class="event-chevron" aria-hidden="true">▶</span>
          <span class="event-accordion-title">${ev.name}</span>
          <span class="event-date-badge">${ev.date}</span>
          <span class="event-task-count">${evTasks.length} việc</span>
        </button>
        ${isPast ? '' : `<button type="button" class="btn btn-sm btn-primary btn-add-event-task" data-add-event="${ev.id}">+ Thêm việc</button>`}
      </div>
      <div class="event-accordion-body" ${isOpen ? '' : 'hidden'}>
        <div class="event-tasks">
          <div class="event-task-row header">
            <span>Nhịp</span><span>Đầu việc</span><span>Chủ trì</span><span>Phối hợp</span><span>Hạn</span><span>TT</span>
          </div>
          ${rows}
        </div>
      </div>
    </div>`;
}

function eventsSectionHTML(key, title, list) {
  const isPast = key === 'past';
  const isOpen = !!eventSectionState[key];
  const body = list.length
    ? list.map(ev => eventCardHTML(ev, isPast)).join('')
    : `<p class="events-section-empty">Không có sự kiện trong mục này</p>`;

  return `
    <div class="events-section ${isOpen ? 'open' : ''}" data-section="${key}">
      <button type="button" class="events-section-header" data-section-toggle="${key}" aria-expanded="${isOpen}">
        <span class="event-chevron" aria-hidden="true">▶</span>
        <span class="events-section-title">${title}</span>
        <span class="events-section-count">${list.length}</span>
      </button>
      <div class="events-section-body" ${isOpen ? '' : 'hidden'}>
        ${body}
      </div>
    </div>`;
}

function renderEvents() {
  const container = $('#events-list');
  const { upcoming, past } = classifyEvents(EVENTS);
  container.innerHTML =
    eventsSectionHTML('upcoming', 'Sự kiện sắp tới', upcoming) +
    eventsSectionHTML('past', 'Đã qua', past);

  container.querySelectorAll('[data-section-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sectionToggle;
      eventSectionState[key] = !eventSectionState[key];
      renderEvents();
    });
  });

  container.querySelectorAll('[data-event-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.eventToggle;
      eventOpenState[id] = !eventOpenState[id];
      renderEvents();
    });
  });

  container.querySelectorAll('.btn-add-event-task').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const evId = btn.dataset.addEvent;
      openModal(null, evId);
    });
  });

  container.querySelectorAll('.event-task-row[data-task-id]').forEach((row) => {
    row.addEventListener('click', () => {
      if (!isAdminActive()) return; // chỉ admin mới sửa việc
      openModal(row.dataset.taskId);
    });
  });
}

function updatePhaseHint() {
  const phase = $('#task-phase')?.value;
  const el = $('#phase-rule-hint');
  if (el) el.textContent = PHASE_RULES[phase] || '';
}

function applyDeadlineFromPhase() {
  const eventId = $('#task-event')?.value;
  const phase = $('#task-phase')?.value;
  if (!eventId || !phase) return;
  const dl = calcDeadlineForPhase(eventId, phase);
  if (!dl) return;
  const { date, time } = splitDeadline(dl);
  $('#task-deadline').value = date;
  $('#task-deadline-time').value = time;
}

function openModal(id = null, presetEventId = null) {
  editingId = id;
  const modal = $('#task-modal');

  if (id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    $('#modal-title').textContent = 'Sửa việc';
    $('#task-event').value = t.eventId;
    $('#task-phase').value = t.phase;
    $('#task-ban').value = t.ban;
    $('#task-desc').value = t.desc;
    $('#task-owner').value = t.owner;
    $('#task-role').value = t.role;
    const { date, time } = splitDeadline(t.deadline);
    $('#task-deadline').value = date;
    $('#task-deadline-time').value = time;
    $('#task-status').value = t.status;
    $('#task-helper').querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = t.helpers?.includes(cb.value) || false;
    });
  } else {
    $('#modal-title').textContent = 'Thêm việc mới';
    $('#task-form').reset();
    $('#task-status').value = 'chua-lam';
    $('#task-deadline-time').value = '08:00';
    if (presetEventId) {
      $('#task-event').value = presetEventId;
    }
    applyDeadlineFromPhase();
  }

  updatePhaseHint();
  modal.showModal();
}

function closeModal() {
  $('#task-modal').close();
  editingId = null;
}

function openEventModal() {
  $('#event-form').reset();
  $('#event-date-display').value = '';
  $('#event-modal').showModal();
}

function closeEventModal() {
  $('#event-modal').close();
}

async function saveEvent(e) {
  e.preventDefault();
  const name = $('#event-name').value.trim();
  const dateISO = $('#event-date-input').value;
  if (!name || !dateISO) return;
  const [y, mo, d] = dateISO.split('-');
  const date = `${d}.${mo}.${y}`;
  try {
    const ev = { name, date };
    if (useServer) {
      const res = await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(ev) });
      EVENTS = res.events;
    } else {
      const id = 'ev' + Date.now().toString(36);
      EVENTS.push({ id, name, date });
    }
    localStorage.setItem('ban-tt-sk-events', JSON.stringify(EVENTS));
    populateSelects();
    renderEvents();
    closeEventModal();
    $('#task-event').value = EVENTS.find(ev2 => ev2.name === name)?.id || '';
  } catch (err) {
    alert('Lỗi thêm sự kiện: ' + err.message);
  }
}

async function saveTask(e) {
  e.preventDefault();
  const helpers = Array.from($('#task-helper').querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);

  const data = {
    eventId: $('#task-event').value,
    phase: $('#task-phase').value,
    ban: $('#task-ban').value,
    desc: $('#task-desc').value.trim(),
    owner: $('#task-owner').value,
    helpers,
    role: $('#task-role').value,
    deadline: `${$('#task-deadline').value}T${$('#task-deadline-time').value}`,
    status: $('#task-status').value
  };

  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx >= 0) tasks[idx] = { ...tasks[idx], ...data };
  } else {
    tasks.push({ id: uid(), ...data });
  }

  await syncTasks();
  closeModal();
  renderAll();
}

// --- Reminders preview (local or API) ---

function buildLocalPreview() {
  const now = new Date();
  const messages = {};
  getActiveTasks().forEach(t => {
    if (t.status === 'da-dang') return;
    const a = deadlineAlert(t.deadline, t.status);
    if (!a.level) return;
    if (!messages[t.owner]) messages[t.owner] = [];
    const urgency = a.level === 'overdue' ? '🔴 QUÁ HẠN' : '🟠 GẦN ĐẾN HẠN';
    messages[t.owner].push({ desc: t.desc, deadline: formatDeadline(t.deadline), urgency });
  });
  return messages;
}

function renderPreviewMessages(messages, sentInfo) {
  const container = $('#bot-messages');
  const names = Object.keys(messages);
  if (!names.length && !sentInfo?.length) {
    container.innerHTML = '<div class="empty-state">Không có việc quá hạn hoặc gần đến hạn</div>';
    return;
  }

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  if (sentInfo?.length) {
    container.innerHTML = sentInfo.map(s => `
      <div class="bot-msg sent">
        <div class="bot-msg-header">
          <span>✅ Đã gửi Telegram → ${s.name}</span>
          <span class="bot-msg-time">${timeStr}</span>
        </div>
        <p>${s.tasks} việc đã nhắc</p>
      </div>`).join('');
    return;
  }

  container.innerHTML = names.map(name => `
    <div class="bot-msg">
      <div class="bot-msg-header">
        <span>📱 Telegram → ${name}</span>
        <span class="bot-msg-time">Xem trước ${timeStr}</span>
      </div>
      <p style="font-size:0.88rem;margin-bottom:0.5rem">Chào ${name}! Việc cần làm:</p>
      <ul>
        ${messages[name].map(m => `<li>${m.urgency} <strong>${m.deadline}</strong> — ${m.desc}</li>`).join('')}
      </ul>
    </div>`).join('');
}

async function previewReminders() {
  if (useServer) {
    try {
      const res = await apiFetch('/api/telegram/preview');
      const previews = (res.sent || []).map(s => ({
        name: s.name,
        lines: (s.preview || '').split('\n').filter(Boolean)
      }));
      if (!previews.length) {
        $('#bot-messages').innerHTML = '<div class="empty-state">Không có việc quá hạn / gần đến hạn (hoặc chưa đăng ký Telegram)</div>';
        return;
      }
      $('#bot-messages').innerHTML = previews.map(p => `
        <div class="bot-msg">
          <div class="bot-msg-header"><span>📱 → ${p.name}</span></div>
          <pre class="preview-text">${p.lines.join('\n')}</pre>
        </div>`).join('');
    } catch (e) {
      renderPreviewMessages(buildLocalPreview());
    }
  } else {
    renderPreviewMessages(buildLocalPreview());
  }
}

// --- Telegram API ---

function applyTelegramUiState(cfg) {
  const locked = cfg.secrets_locked && !cfg.is_admin;
  const banner = $('#tg-locked-banner');
  if (banner) banner.hidden = !cfg.secrets_locked;
  const secretFields = $('#tg-secret-fields');
  if (secretFields) secretFields.hidden = locked;
  $$('.tg-admin-only').forEach((el) => { el.hidden = locked; });
  const savePublic = $('#btn-tg-save-public');
  if (savePublic) savePublic.hidden = !locked;
  const status = $('#tg-locked-status');
  if (status && cfg.secrets_locked) {
    const parts = [];
    if (cfg.bot_token_hint) parts.push(`Bot: ${cfg.bot_token_hint}`);
    if (cfg.group_chat_id) parts.push(`Group: ${cfg.group_chat_id}`);
    status.textContent = parts.join(' · ') || 'Đã cấu hình trên server';
  }
}

async function loadTelegramConfig() {
  try {
    const cfg = await apiFetch('/api/telegram/config', { headers: adminHeaders() });
    $('#tg-token').placeholder = cfg.bot_token_hint || cfg.bot_token || '123456:ABC...';
    if (cfg.is_admin) {
      $('#tg-group').value = cfg.group_chat_id || '';
    } else {
      $('#tg-group').value = '';
      $('#tg-group').placeholder = cfg.group_chat_id || '-100...';
    }
    $('#tg-hour').value = cfg.reminder_hour ?? 7;
    $('#tg-enabled').checked = !!cfg.enabled;
    applyTelegramUiState(cfg);
    const hint = $('#tg-deploy-hint');
    if (hint) {
      if (cfg.production && cfg.webhook_url) {
        hint.innerHTML = `🌐 Deploy: Webhook <code>${cfg.webhook_url}</code>`;
      } else if (cfg.production) {
        hint.textContent = 'Deploy: thêm TELEGRAM_BOT_TOKEN trên Render → bấm Kết nối Webhook';
      }
    }
  } catch { /* ignore */ }
}

async function unlockTelegramAdmin() {
  const pin = prompt('Nhập mã quản trị viên (ADMIN_PIN trên Render):');
  if (!pin) return;
  try {
    const res = await apiFetch('/api/admin/verify', {
      method: 'POST',
      body: JSON.stringify({ admin_pin: pin }),
    });
    if (res.ok) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, pin);
      await loadTelegramConfig();
      $('#tg-status').innerHTML = '<p class="ok">✓ Đã mở khóa — có thể sửa Token / Group ID</p>';
    }
  } catch {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    alert('Mã quản trị không đúng');
  }
}

// Admin nhắc ĐÚNG một việc → gửi Telegram tới Chủ trì + Phối hợp của việc đó
async function remindTask(id) {
  if (!isAdminActive()) return;
  if (!useServer) { alert('Cần chạy server để gửi nhắc Telegram.'); return; }
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  const who = [t.owner, ...(t.helpers || [])].filter(Boolean).join(', ');
  if (!confirm(`Gửi nhắc việc này qua Telegram cho: ${who || '(chưa có người)'}?`)) return;
  const status = $('#mine-reminder-status');
  if (status) status.innerHTML = '<span class="hint">Đang gửi nhắc...</span>';
  try {
    const res = await apiFetch('/api/telegram/notify-task', {
      method: 'POST',
      body: JSON.stringify({ task_id: id }),
    });
    if (res.ok) {
      const parts = [];
      if (res.sent?.length) parts.push(`✓ Đã nhắc: ${res.sent.join(', ')}`);
      if (res.unregistered?.length) parts.push(`⚠ Chưa đăng ký bot: ${res.unregistered.join(', ')}`);
      if (res.failed?.length) parts.push(`✗ Gửi lỗi: ${res.failed.join(', ')}`);
      const msg = parts.join(' · ');
      if (status) status.innerHTML = `<span class="ok">${msg}</span>`; else alert(msg);
    } else if (status) {
      status.innerHTML = `<span class="err">✗ ${res.error}</span>`;
    } else {
      alert('✗ ' + res.error);
    }
  } catch (e) {
    if (status) status.innerHTML = `<span class="err">Lỗi: ${e.message}</span>`;
    else alert('Lỗi: ' + e.message);
  }
}

async function setupTelegramWebhook() {
  if (!useServer) return;
  try {
    const res = await apiFetch('/api/telegram/setup-webhook', { method: 'POST', body: '{}' });
    if (res.ok) {
      $('#tg-status').innerHTML = `<p class="ok">✓ Webhook: ${res.webhook_url}</p>`;
    } else {
      $('#tg-status').innerHTML = `<p class="err">✗ ${res.error}</p>`;
    }
  } catch (e) {
    $('#tg-status').innerHTML = `<p class="err">${e.message}</p>`;
  }
}

async function saveTelegramConfig() {
  if (!useServer) return;
  try {
    const body = {
      bot_token: $('#tg-token').value,
      group_chat_id: $('#tg-group').value,
      reminder_hour: parseInt($('#tg-hour').value, 10),
      enabled: $('#tg-enabled').checked
    };
    await apiFetch('/api/telegram/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    });
    $('#tg-status').innerHTML = '<p class="ok">✓ Đã lưu cấu hình Telegram</p>';
    $('#tg-token').value = '';
    await loadTelegramConfig();
  } catch (e) {
    $('#tg-status').innerHTML = `<p class="err">Lỗi: ${e.message}</p>`;
  }
}

async function saveTelegramConfigPublic() {
  if (!useServer) return;
  try {
    const body = {
      reminder_hour: parseInt($('#tg-hour').value, 10),
      enabled: $('#tg-enabled').checked
    };
    await apiFetch('/api/telegram/config', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(body),
    });
    $('#tg-status').innerHTML = '<p class="ok">✓ Đã lưu giờ nhắc</p>';
  } catch (e) {
    $('#tg-status').innerHTML = `<p class="err">Lỗi: ${e.message}</p>`;
  }
}

async function testTelegram() {
  if (!useServer) return;
  try {
    const token = $('#tg-token').value;
    const res = await apiFetch('/api/telegram/test', {
      method: 'POST',
      body: JSON.stringify({ bot_token: token || undefined })
    });
    if (res.ok) {
      $('#tg-status').innerHTML = `<p class="ok">✓ Bot: @${res.result.username} — ${res.result.first_name}</p>`;
    } else {
      $('#tg-status').innerHTML = `<p class="err">✗ ${res.description || 'Lỗi kết nối'}</p>`;
    }
  } catch (e) {
    $('#tg-status').innerHTML = `<p class="err">${e.message}</p>`;
  }
}

async function sendTelegramReminders() {
  if (!useServer) {
    alert('Cần chạy server.py');
    return;
  }
  if (!confirm('Gửi nhắc việc qua Telegram cho tất cả thành viên đã đăng ký?')) return;
  try {
    const res = await apiFetch('/api/telegram/send', { method: 'POST', body: '{}' });
    if (res.errors?.length) {
      $('#tg-status').innerHTML = `<p class="err">Một số lỗi: ${res.errors.map(e => e.name).join(', ')}</p>`;
    }
    renderPreviewMessages({}, res.sent);
    if (!res.sent?.length) {
      $('#bot-messages').innerHTML = '<div class="empty-state">Không gửi được — kiểm tra token và thành viên đã /start chưa</div>';
    }
  } catch (e) {
    $('#tg-status').innerHTML = `<p class="err">${e.message}</p>`;
  }
}

async function loadTelegramUsers() {
  if (!useServer) return;
  try {
    const users = await apiFetch('/api/telegram/users', { headers: adminHeaders() });
    const names = Object.entries(users);
    $('#tg-users').innerHTML = names.length
      ? `<p class="hint"><strong>Đã đăng ký Telegram:</strong> ${names.map(([n, id]) => `${n}${id ? ` (${id})` : ''}`).join(' · ')}</p>`
      : '<p class="hint">Chưa ai đăng ký — nhắn bot <code>/start Tên</code></p>';
  } catch { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', init);
