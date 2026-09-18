/* =====================================================================
   TeamBoard - frontend (plain JavaScript, no build step)
   CodeAlpha Task 3
   ---------------------------------------------------------------------
   Sections:
     1. state + tiny helpers
     2. API wrapper (adds the JWT to every request)
     3. authentication screen
     4. socket.io real-time wiring
     5. dashboard (projects)
     6. board (columns, cards, drag & drop)
     7. task modal + comments
     8. notifications
   ===================================================================== */

/* ----------------------- 1. state + helpers ------------------------ */
const state = {
  token: localStorage.getItem('tb_token') || null,
  user: null,
  projects: [],
  project: null,       // the board currently open
  tasks: [],
  openTaskId: null,
  socket: null
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

/** escape user text before putting it in innerHTML (basic XSS protection) */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(iso).toLocaleDateString();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2600);
}

/* --------------------------- 2. API -------------------------------- */
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) logout();                 // token dead -> back to login
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

/* ---------------------- 3. authentication -------------------------- */
$$('[data-auth-tab]').forEach(tab => {
  tab.onclick = () => {
    $$('[data-auth-tab]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const login = tab.dataset.authTab === 'login';
    login ? show($('#login-form')) : hide($('#login-form'));
    login ? hide($('#register-form')) : show($('#register-form'));
    hide($('#auth-error'));
  };
});

function authError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  show(el);
}

$('#login-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: f.get('email'), password: f.get('password') }
    });
    startSession(data);
  } catch (err) { authError(err.message); }
};

$('#register-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name: f.get('name'), email: f.get('email'), password: f.get('password') }
    });
    startSession(data);
  } catch (err) { authError(err.message); }
};

function startSession({ token, user }) {
  state.token = token;
  state.user = user;
  localStorage.setItem('tb_token', token);

  hide($('#auth-screen'));
  show($('#app'));
  $('#user-name').textContent = user.name;
  $('#user-avatar').textContent = (user.name[0] || '?').toUpperCase();

  connectSocket();
  loadProjects();
  loadNotifications();
}

function logout() {
  localStorage.removeItem('tb_token');
  if (state.socket) state.socket.disconnect();
  state.token = null; state.user = null;
  show($('#auth-screen'));
  hide($('#app'));
}
$('#logout-btn').onclick = logout;

/* ------------------ 4. socket.io real-time wiring ------------------ */
function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    if (state.project) state.socket.emit('project:join', state.project.id);
  });

  // --- board events ---
  state.socket.on('task:created', task => {
    if (!state.project || task.projectId !== state.project.id) return;
    if (!state.tasks.some(t => t.id === task.id)) state.tasks.push(task);
    renderBoard();
  });

  state.socket.on('task:updated', task => {
    if (!state.project || task.projectId !== state.project.id) return;
    state.tasks = state.tasks.map(t => (t.id === task.id ? task : t));
    renderBoard();
    if (state.openTaskId === task.id) fillDetail(task);
  });

  state.socket.on('task:deleted', ({ id }) => {
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderBoard();
    if (state.openTaskId === id) closeModal($('#detail-modal'));
  });

  state.socket.on('project:updated', project => {
    if (state.project && project.id === state.project.id) {
      state.project = project;
      renderMembers();
    }
    loadProjects();
  });

  state.socket.on('project:deleted', ({ id }) => {
    if (state.project && state.project.id === id) goDashboard();
    loadProjects();
  });

  // --- comments (communication inside a task) ---
  state.socket.on('comment:created', comment => {
    if (state.openTaskId === comment.taskId) appendComment(comment);
    const t = state.tasks.find(x => x.id === comment.taskId);
    if (t) { t.commentCount = (t.commentCount || 0) + 1; renderBoard(); }
  });

  state.socket.on('comment:deleted', ({ id, taskId }) => {
    const node = document.querySelector(`[data-comment="${id}"]`);
    if (node) node.remove();
    const t = state.tasks.find(x => x.id === taskId);
    if (t && t.commentCount) { t.commentCount -= 1; renderBoard(); }
  });

  // --- someone is typing in the open task ---
  let typingTimer;
  state.socket.on('task:typing', ({ taskId, userName }) => {
    if (state.openTaskId !== taskId) return;
    const hint = $('#typing-hint');
    hint.textContent = userName + ' is typing...';
    show(hint);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => hide(hint), 1500);
  });

  // --- notifications ---
  state.socket.on('notification:new', n => {
    toast(n.text);
    prependNotification(n);
  });
}

/* ----------------------- 5. dashboard ------------------------------ */
async function loadProjects() {
  state.projects = await api('/projects');
  const grid = $('#project-grid');
  grid.innerHTML = state.projects.map(p => `
    <div class="project-card" data-project="${p.id}">
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc(p.description || 'No description')}</p>
      <div class="meta">
        <div class="member-avatars">
          ${p.members.slice(0, 4).map(m =>
            `<span class="avatar sm" title="${esc(m.name)}">${esc((m.name[0] || '?').toUpperCase())}</span>`).join('')}
        </div>
        <span>${p.taskCount} task${p.taskCount === 1 ? '' : 's'}</span>
      </div>
    </div>`).join('');

  state.projects.length ? hide($('#no-projects')) : show($('#no-projects'));
  $$('.project-card').forEach(card => {
    card.onclick = () => openProject(card.dataset.project);
  });
}

$('#new-project-btn').onclick = () => openModal($('#project-modal'));
$('#home-btn').onclick = goDashboard;
$('#back-btn').onclick = goDashboard;

$('#project-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const project = await api('/projects', {
      method: 'POST',
      body: { name: f.get('name'), description: f.get('description') }
    });
    closeModal($('#project-modal'));
    e.target.reset();
    await loadProjects();
    openProject(project.id);
  } catch (err) { toast(err.message); }
};

function goDashboard() {
  if (state.project && state.socket) state.socket.emit('project:leave', state.project.id);
  state.project = null;
  hide($('#board-page'));
  show($('#dashboard'));
  loadProjects();
}

/* -------------------------- 6. board ------------------------------- */
async function openProject(id) {
  state.project = await api('/projects/' + id);
  state.tasks = await api('/tasks?projectId=' + id);

  hide($('#dashboard'));
  show($('#board-page'));
  $('#board-title').textContent = state.project.name;
  $('#board-desc').textContent = state.project.description || '';

  state.socket.emit('project:join', id);     // start receiving live updates
  renderMembers();
  renderBoard();
}

function renderMembers() {
  $('#member-avatars').innerHTML = state.project.members.map(m =>
    `<span class="avatar sm" title="${esc(m.name)} (${esc(m.email)})">${esc((m.name[0] || '?').toUpperCase())}</span>`
  ).join('');
}

function renderBoard() {
  if (!state.project) return;
  const board = $('#board');

  board.innerHTML = state.project.columns.map(col => {
    const cards = state.tasks
      .filter(t => t.columnId === col.id)
      .sort((a, b) => a.order - b.order);

    return `
      <div class="column" data-column="${col.id}">
        <div class="column-head"><span>${esc(col.title)}</span><span class="count">${cards.length}</span></div>
        ${cards.map(cardHtml).join('')}
      </div>`;
  }).join('');

  wireDragAndDrop();
}

function cardHtml(t) {
  const due = t.dueDate ? `<span class="tag due">${new Date(t.dueDate).toLocaleDateString()}</span>` : '';
  const who = t.assignee
    ? `<span class="avatar sm" title="${esc(t.assignee.name)}">${esc((t.assignee.name[0] || '?').toUpperCase())}</span>`
    : '<span class="tag">Unassigned</span>';
  return `
    <div class="card p-${t.priority}" draggable="true" data-task="${t.id}">
      <h4>${esc(t.title)}</h4>
      ${t.description ? `<p class="muted">${esc(t.description.slice(0, 70))}${t.description.length > 70 ? '...' : ''}</p>` : ''}
      <div class="card-foot">
        <span>${due}<span class="tag">${esc(t.priority)}</span>&#128172; ${t.commentCount || 0}</span>
        ${who}
      </div>
    </div>`;
}

/* --- HTML5 drag & drop: moving a card fires a PATCH, which the server
       broadcasts, so every teammate's board moves too --- */
function wireDragAndDrop() {
  let draggedId = null;

  $$('.card').forEach(card => {
    card.onclick = () => openTaskDetail(card.dataset.task);
    card.ondragstart = e => {
      draggedId = card.dataset.task;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragend = () => card.classList.remove('dragging');
  });

  $$('.column').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('drag-over'); };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const task = state.tasks.find(t => t.id === draggedId);
      if (!task || task.columnId === col.dataset.column) return;

      task.columnId = col.dataset.column;        // optimistic UI
      renderBoard();
      try {
        await api('/tasks/' + task.id, { method: 'PATCH', body: { columnId: col.dataset.column } });
      } catch (err) { toast(err.message); openProject(state.project.id); }
    };
  });
}

/* ----------------- add member / add task buttons ------------------- */
$('#add-member-btn').onclick = () => openModal($('#member-modal'));

$('#member-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    state.project = await api(`/projects/${state.project.id}/members`, {
      method: 'POST', body: { email: f.get('email') }
    });
    renderMembers();
    closeModal($('#member-modal'));
    e.target.reset();
    toast('Member added');
  } catch (err) { toast(err.message); }
};

$('#add-task-btn').onclick = () => openTaskForm();

function openTaskForm(task) {
  const form = $('#task-form');
  form.reset();
  $('#task-modal-title').textContent = task ? 'Edit task' : 'New task';

  // fill the two dropdowns from the current project
  $('#assignee-select').innerHTML = '<option value="">Unassigned</option>' +
    state.project.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('#column-select').innerHTML =
    state.project.columns.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');

  form.id.value = task ? task.id : '';
  if (task) {
    form.title.value = task.title;
    form.description.value = task.description || '';
    form.assigneeId.value = task.assigneeId || '';
    form.columnId.value = task.columnId;
    form.priority.value = task.priority;
    form.dueDate.value = task.dueDate ? task.dueDate.slice(0, 10) : '';
  }
  openModal($('#task-modal'));
}

$('#task-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    title: f.get('title'),
    description: f.get('description'),
    assigneeId: f.get('assigneeId') || null,
    columnId: f.get('columnId'),
    priority: f.get('priority'),
    dueDate: f.get('dueDate') || null
  };
  const id = f.get('id');
  try {
    if (id) {
      await api('/tasks/' + id, { method: 'PATCH', body });
    } else {
      await api('/tasks', { method: 'POST', body: { ...body, projectId: state.project.id } });
    }
    closeModal($('#task-modal'));
    state.tasks = await api('/tasks?projectId=' + state.project.id);
    renderBoard();
  } catch (err) { toast(err.message); }
};

/* ------------------ 7. task detail + comments ---------------------- */
async function openTaskDetail(taskId) {
  state.openTaskId = taskId;
  const task = await api('/tasks/' + taskId);
  fillDetail(task);
  $('#comment-list').innerHTML = '';
  task.comments.forEach(appendComment);
  openModal($('#detail-modal'));
}

function fillDetail(task) {
  $('#detail-title').textContent = task.title;
  $('#detail-meta').textContent =
    `${task.priority} priority · ${task.assignee ? 'assigned to ' + task.assignee.name : 'unassigned'}` +
    (task.dueDate ? ' · due ' + new Date(task.dueDate).toLocaleDateString() : '');
  $('#detail-desc').textContent = task.description || 'No description.';

  $('#detail-edit').onclick = () => {
    closeModal($('#detail-modal'));
    openTaskForm(task);
  };
  $('#detail-delete').onclick = async () => {
    if (!confirm('Delete this task and all its comments?')) return;
    await api('/tasks/' + task.id, { method: 'DELETE' });
    closeModal($('#detail-modal'));
  };
}

function appendComment(c) {
  const mine = c.userId === state.user.id;
  const div = document.createElement('div');
  div.className = 'comment';
  div.dataset.comment = c.id;
  div.innerHTML = `
    <span class="avatar sm">${esc(((c.author && c.author.name) || '?')[0].toUpperCase())}</span>
    <div class="comment-body">
      <span class="who">${esc(c.author ? c.author.name : 'Unknown')}
        <span class="when">${timeAgo(c.createdAt)}</span></span>
      <p>${esc(c.text)}</p>
    </div>
    ${mine ? '<button class="del" title="Delete">&times;</button>' : ''}`;

  if (mine) {
    div.querySelector('.del').onclick = () =>
      api('/comments/' + c.id, { method: 'DELETE' }).catch(err => toast(err.message));
  }
  const list = $('#comment-list');
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

$('#comment-form').onsubmit = async e => {
  e.preventDefault();
  const input = e.target.text;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await api('/comments', { method: 'POST', body: { taskId: state.openTaskId, text } });
    // the comment arrives back through the socket, so nothing to do here
  } catch (err) { toast(err.message); }
};

// tell teammates that I am typing
$('#comment-form').text.oninput = () => {
  if (!state.openTaskId || !state.project) return;
  state.socket.emit('task:typing', {
    projectId: state.project.id, taskId: state.openTaskId, userName: state.user.name
  });
};

/* --------------------- 8. notifications ---------------------------- */
async function loadNotifications() {
  const list = await api('/notifications');
  $('#notif-list').innerHTML = list.length
    ? list.map(notifHtml).join('')
    : '<p class="empty" style="margin:24px 0">Nothing yet.</p>';
  updateBell(list.filter(n => !n.read).length);
}

function notifHtml(n) {
  return `<div class="notif ${n.read ? '' : 'unread'}" data-notif="${n.id}" data-project="${n.projectId || ''}">
            ${esc(n.text)}<time>${timeAgo(n.createdAt)}</time>
          </div>`;
}

function prependNotification(n) {
  const list = $('#notif-list');
  if (list.querySelector('.empty')) list.innerHTML = '';
  list.insertAdjacentHTML('afterbegin', notifHtml(n));
  updateBell(list.querySelectorAll('.unread').length);
}

function updateBell(count) {
  const badge = $('#bell-count');
  badge.textContent = count;
  count ? show(badge) : hide(badge);
}

$('#bell-btn').onclick = e => {
  e.stopPropagation();
  $('#bell-panel').classList.toggle('hidden');
};

$('#read-all-btn').onclick = async () => {
  await api('/notifications/read-all', { method: 'POST' });
  loadNotifications();
};

// click a notification -> open that project board
$('#notif-list').onclick = async e => {
  const item = e.target.closest('.notif');
  if (!item) return;
  await api(`/notifications/${item.dataset.notif}/read`, { method: 'PATCH' }).catch(() => {});
  item.classList.remove('unread');
  updateBell($('#notif-list').querySelectorAll('.unread').length);
  if (item.dataset.project) {
    hide($('#bell-panel'));
    openProject(item.dataset.project);
  }
};

document.addEventListener('click', e => {
  if (!e.target.closest('.bell-wrap')) hide($('#bell-panel'));
});

/* ------------------------- modal helpers --------------------------- */
function openModal(m) { show(m); }
function closeModal(m) { hide(m); if (m.id === 'detail-modal') state.openTaskId = null; }

$$('[data-close]').forEach(btn => btn.onclick = () => closeModal(btn.closest('.modal')));
$$('.modal').forEach(m => {
  m.onclick = e => { if (e.target === m) closeModal(m); };   // click the dark area to close
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('.modal').forEach(m => closeModal(m));
});

/* ------------------- restore session on reload --------------------- */
(async function boot() {
  if (!state.token) return;
  try {
    const { user } = await api('/auth/me');
    startSession({ token: state.token, user });
  } catch { logout(); }
})();
