let tasks = [];
let editingId = null;
let countdownTimer = null;
const ADMIN_SESSION_KEY = 'ban-tt-sk-admin-pin';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function adminHeaders() {
  const pin = sessionStorage.getItem(ADMIN_SESSION_KEY);
  return pin ? { 'X-Admin-Pin': pin } : {};
}

async function init() {
  await checkServer();
  await loadEvents();
  const loaded = await loadTasks();
  tasks = migrateTasksDeadlines(loaded);
  if (useServer && JSON.stringify(loaded) !== JSON.stringify(tasks)) {
    await persistTasks(tasks);
  }

  populateSelects();
  bindEvents();
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
  const eventOpts = EVENTS.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  const filterEventOpts = EVENTS.map(e => `<option value="${e.id}">${e.name} — ${e.date}</option>`).join('');
  $('#task-event').innerHTML = eventOpts;
  $('#filter-event').innerHTML = '<option value="">Tất cả sự kiện</option>' + filterEventOpts;

  const memberOpts = MEMBERS.map(m => `<option value="${m}">${m}</option>`).join('');
  $('#task-owner').innerHTML = memberOpts;
  $('#task-helper').innerHTML = memberOpts;
  $('#my-name').innerHTML = '<option value="">— Chọn tên —</option>' + memberOpts;

  const savedUser = localStorage.getItem(STORAGE_USER_KEY);
  if (savedUser) $('#my-name').value = savedUser;
}

function bindEvents() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'bot' && useServer) loadTelegramUsers();
    });
  });

  $('#btn-add-task').addEventListener('click', () => openModal());
  $('#btn-import-excel').addEventListener('click', () => $('#excel-file').click());
  $('#excel-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFromExcel(file);
    e.target.value = '';
  });
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#task-form').addEventListener('submit', saveTask);

  $('#filter-ban').addEventListener('change', renderKanban);
  $('#filter-event').addEventListener('change', renderKanban);
  $('#task-event').addEventListener('change', () => { updatePhaseHint(); applyDeadlineFromPhase(); });
  $('#task-phase').addEventListener('change', () => { updatePhaseHint(); applyDeadlineFromPhase(); });
  $('#my-name').addEventListener('change', (e) => {
    localStorage.setItem(STORAGE_USER_KEY, e.target.value);
    renderMyTasks();
    updateMemberReminderButton();
    $('#mine-reminder-status').innerHTML = '';
  });

  $('#btn-send-member-reminder')?.addEventListener('click', sendMemberReminder);
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
  btn.disabled = !useServer || !$('#my-name').value;
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
  await persistTasks(tasks);
}

function renderAll() {
  renderAlertBanner();
  renderKanban();
  renderMyTasks();
  renderEvents();
  tickCountdowns();
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
  tasks.forEach(t => {
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

function renderKanban() {
  const filterBan = $('#filter-ban').value;
  const filterEvent = $('#filter-event').value;
  let filtered = tasks;
  if (filterBan) filtered = filtered.filter(t => t.ban === filterBan);
  if (filterEvent) filtered = filtered.filter(t => t.eventId === filterEvent);

  const statuses = ['chua-lam', 'dang-lam', 'cho-duyet', 'da-dang'];
  const board = $('#kanban-board');
  board.innerHTML = statuses.map(status => {
    const colTasks = filtered.filter(t => t.status === status);
    return `
      <div class="kanban-col" data-status="${status}">
        <div class="col-header">
          <span>${STATUS_LABELS[status]}</span>
          <span class="col-count">${colTasks.length}</span>
        </div>
        ${colTasks.map(t => taskCardHTML(t)).join('')}
      </div>`;
  }).join('');

  board.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.task-actions')) return;
      openModal(card.dataset.id);
    });
  });

  board.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.closest('.task-card').dataset.id;
      const action = btn.dataset.action;
      if (action === 'next') advanceStatus(id);
      else if (action === 'delete') deleteTask(id);
    });
  });
}

function taskCardHTML(t) {
  const ev = getEvent(t.eventId);
  const dlClass = deadlineClass(t.deadline, t.status);
  const alertHtml = alertBadgeHTML(t.deadline, t.status);
  const helpers = t.helpers?.length ? t.helpers.join(', ') : '—';
  const nextStatus = getNextStatus(t.status);
  return `
    <div class="task-card ${dlClass}" data-id="${t.id}">
      ${alertHtml}
      <div class="task-phase">${t.phase} · ${ev?.name || ''}</div>
      <span class="task-ban ${banClass(t.ban)}">${t.ban}</span>
      <div class="task-desc">${t.desc}</div>
      <div class="task-meta">
        <strong>${t.owner}</strong> · PH: ${helpers}
        ${t.role === 'CHÍNH' ? ' · <em>CHÍNH</em>' : ''}
      </div>
      <div class="task-deadline ${dlClass}">Hạn: ${formatDeadline(t.deadline)}</div>
      ${countdownHTML(t.deadline, t.status, t.id)}
      <div class="task-actions">
        ${nextStatus ? `<button class="btn btn-sm btn-secondary" data-action="next">→ ${STATUS_LABELS[nextStatus]}</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="delete">Xóa</button>
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
  if (!confirm('Xóa việc này?')) return;
  tasks = tasks.filter(t => t.id !== id);
  await syncTasks();
  renderAll();
}

function renderMyTasks() {
  const name = $('#my-name').value;
  const container = $('#my-tasks');
  if (!name) {
    container.innerHTML = '<div class="empty-state">Chọn tên của bạn để xem việc được giao</div>';
    return;
  }

  const mine = tasks.filter(t =>
    t.owner === name || (t.helpers && t.helpers.includes(name))
  ).sort((a, b) => a.deadline.localeCompare(b.deadline));

  if (!mine.length) {
    container.innerHTML = '<div class="empty-state">Không có việc nào được giao cho bạn</div>';
    return;
  }

  container.innerHTML = mine.map(t => {
    const ev = getEvent(t.eventId);
    const isOwner = t.owner === name;
    const dlClass = deadlineClass(t.deadline, t.status);
    const alertHtml = alertBadgeHTML(t.deadline, t.status);
    return `
      <div class="my-task-item ${isOwner ? 'chinh' : ''} ${dlClass}" data-id="${t.id}">
        <div>
          ${alertHtml}
          <div class="task-phase">${t.phase} · ${ev?.name || ''} · ${t.ban}</div>
          <div class="task-desc" style="margin:0.35rem 0">${t.desc}</div>
          <div class="task-meta">
            ${isOwner ? '<strong>Chủ trì (bạn)</strong>' : `Chủ trì: ${t.owner}`}
            ${t.helpers?.length ? ` · Phối hợp: ${t.helpers.join(', ')}` : ''}
          </div>
          <div class="task-deadline ${dlClass}">Hạn: ${formatDeadline(t.deadline)}</div>
          ${countdownHTML(t.deadline, t.status, t.id)}
        </div>
        <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status]}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.my-task-item').forEach(item => {
    item.addEventListener('click', () => openModal(item.dataset.id));
  });
}

function renderEvents() {
  const container = $('#events-list');
  container.innerHTML = EVENTS.map(ev => {
    const evTasks = tasks.filter(t => t.eventId === ev.id);
    const rows = evTasks.length ? evTasks.map(t => `
      <div class="event-task-row">
        <span>${t.phase}</span>
        <span>${t.desc}</span>
        <span>${t.owner}</span>
        <span>${t.helpers?.join(', ') || '—'}</span>
        <span class="deadline-cell">
          <span>${formatDeadline(t.deadline)}</span>
          ${countdownHTML(t.deadline, t.status, t.id)}
        </span>
        <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status]}</span>
      </div>`).join('') : '<p style="padding:0.5rem 0;color:var(--text-muted);font-size:0.85rem">Chưa có đầu việc — bấm Thêm việc</p>';

    return `
      <div class="event-card">
        <div class="event-header">
          <h3>${ev.name}</h3>
          <span class="event-date">${ev.date}</span>
        </div>
        <div class="event-tasks">
          <div class="event-task-row header">
            <span>Nhịp</span><span>Đầu việc</span><span>Chủ trì</span><span>Phối hợp</span><span>Hạn</span><span>TT</span>
          </div>
          ${rows}
        </div>
      </div>`;
  }).join('');
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

function openModal(id = null) {
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
    Array.from($('#task-helper').options).forEach(opt => {
      opt.selected = t.helpers?.includes(opt.value) || false;
    });
  } else {
    $('#modal-title').textContent = 'Thêm việc mới';
    $('#task-form').reset();
    $('#task-status').value = 'chua-lam';
    $('#task-deadline-time').value = '08:00';
    applyDeadlineFromPhase();
  }

  updatePhaseHint();
  modal.showModal();
}

function closeModal() {
  $('#task-modal').close();
  editingId = null;
}

async function saveTask(e) {
  e.preventDefault();
  const helpers = Array.from($('#task-helper').selectedOptions).map(o => o.value);

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
  tasks.forEach(t => {
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

async function sendMemberReminder() {
  const name = $('#my-name').value;
  if (!name || !useServer) return;
  if (!confirm(`Gửi danh sách việc đang mở qua Telegram cho ${name}?`)) return;
  const status = $('#mine-reminder-status');
  status.innerHTML = '<span class="hint">Đang gửi...</span>';
  try {
    const res = await apiFetch('/api/telegram/send-user', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      status.innerHTML = `<span class="ok">✓ Đã gửi ${res.tasks} việc cho ${name} qua Telegram</span>`;
    } else {
      status.innerHTML = `<span class="err">✗ ${res.error}</span>`;
    }
  } catch (e) {
    status.innerHTML = `<span class="err">Lỗi: ${e.message}</span>`;
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
