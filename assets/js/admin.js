// ============================================================
// ADMIN.JS — Admin panel logic
// ============================================================

let currentAdmin = null;
let allUsers = [];
let allProjects = [];

// ── INIT ─────────────────────────────────────────────────
async function initAdmin() {
  const result = await requireAuth('admin');
  if (!result) return;

  currentAdmin = result.profile;
  document.getElementById('admin-name').textContent = currentAdmin.full_name || 'Admin';

  await Promise.all([loadStats(), loadUsers(), loadAllProjects()]);
  showSection('overview');
}

// ── STATS ─────────────────────────────────────────────────
async function loadStats() {
  const [usersRes, studentsRes, recruitersRes, projectsRes] = await Promise.all([
    window.sb.from('users').select('id', { count: 'exact', head: true }),
    window.sb.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    window.sb.from('users').select('id', { count: 'exact', head: true }).eq('role', 'recruiter'),
    window.sb.from('projects').select('id', { count: 'exact', head: true })
  ]);

  document.getElementById('stat-total-users').textContent = usersRes.count || 0;
  document.getElementById('stat-students').textContent = studentsRes.count || 0;
  document.getElementById('stat-recruiters').textContent = recruitersRes.count || 0;
  document.getElementById('stat-projects').textContent = projectsRes.count || 0;
}

// ── LOAD USERS ────────────────────────────────────────────
async function loadUsers() {
  const { data, error } = await window.sb
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to load users', 'error'); return; }
  allUsers = data || [];
  renderUsersTable(allUsers);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell__avatar">${getInitials(u.full_name || u.email)}</div>
          <div>
            <div class="user-cell__name">${escHtml(u.full_name || '—')}</div>
            <div class="user-cell__email">${escHtml(u.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="role-badge role-badge--${u.role}">${u.role}</span></td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${u.id === currentAdmin.id ? '<span class="muted">You</span>' : `
        <button class="btn btn--sm btn--danger" onclick="deleteUser('${u.id}','${escHtml(u.email)}')">Delete</button>
      `}</td>
    </tr>
  `).join('');
}

function getInitials(str) {
  return (str || '?').split(/[\s@]/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── SEARCH USERS ──────────────────────────────────────────
function searchUsers(q) {
  if (!q.trim()) { renderUsersTable(allUsers); return; }
  const filtered = allUsers.filter(u =>
    u.email?.toLowerCase().includes(q.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(q.toLowerCase())
  );
  renderUsersTable(filtered);
}

function filterByRole(role) {
  if (!role) { renderUsersTable(allUsers); return; }
  renderUsersTable(allUsers.filter(u => u.role === role));
}

// ── DELETE USER ───────────────────────────────────────────
async function deleteUser(userId, email) {
  if (!confirm(`Delete user "${email}"? This is irreversible.`)) return;

  // Delete from public users table (cascade should handle profiles/projects via FK)
  const { error } = await window.sb.from('users').delete().eq('id', userId);
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }

  showToast(`Deleted ${email}`, 'warn');
  allUsers = allUsers.filter(u => u.id !== userId);
  renderUsersTable(allUsers);
  await loadStats();
}

// ── ALL PROJECTS ──────────────────────────────────────────
async function loadAllProjects() {
  const { data, error } = await window.sb
    .from('projects')
    .select(`*, users:user_id (full_name, email, role)`)
    .order('created_at', { ascending: false });

  if (error) return;
  allProjects = data || [];
  renderProjectsTable(allProjects);
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-tbody');
  if (!tbody) return;

  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No projects</td></tr>';
    return;
  }

  tbody.innerHTML = projects.map(p => `
    <tr>
      <td><strong>${escHtml(p.title)}</strong></td>
      <td>${escHtml(p.users?.full_name || p.users?.email || '—')}</td>
      <td>
        <div class="skill-chips-row skill-chips-row--sm">
          ${(p.tech_stack || []).slice(0, 4).map(s => `<span class="skill-chip skill-chip--sm">${escHtml(s)}</span>`).join('')}
        </div>
      </td>
      <td>${fmtDate(p.created_at)}</td>
      <td>
        <button class="btn btn--sm btn--danger" onclick="deleteProject('${p.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  const { error } = await window.sb.from('projects').delete().eq('id', id);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  showToast('Project deleted', 'warn');
  allProjects = allProjects.filter(p => p.id !== id);
  renderProjectsTable(allProjects);
  await loadStats();
}

// ── SECTION NAV ───────────────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', initAdmin);