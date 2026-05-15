// ============================================================
// RECRUITER.JS — Recruiter dashboard logic
// ============================================================

let currentUser = null;
let currentProfile = null;
let allStudents = [];
let filterSkills = [];
let shortlist = [];
let filterSkillsInput = null;

// ── INIT ─────────────────────────────────────────────────
async function initRecruiter() {
  const result = await requireAuth('recruiter');
  if (!result) return;

  currentUser = result.session.user;
  currentProfile = result.profile;

  document.getElementById('user-name').textContent = currentProfile.full_name || currentUser.email;
  document.getElementById('user-email').textContent = currentUser.email;
  const initials = (currentProfile.full_name || currentUser.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent = initials;

  filterSkillsInput = initSkillInput({
    wrapId: 'filter-skills-wrap',
    inputId: 'filter-skill-input',
    suggestId: 'filter-skill-suggest',
    arr: filterSkills,
    max: 10,
    onChange: () => applyFilters()
  });

  await loadStudents();
  setupSearch();
  showSection('browse');
}

// ── LOAD ALL STUDENTS ─────────────────────────────────────
async function loadStudents() {
  const loadingEl = document.getElementById('students-loading');
  const gridEl = document.getElementById('students-grid');
  if (loadingEl) loadingEl.classList.remove('hidden');

  // Join student_profiles with users, plus their projects
  // Projects are linked to users (not student_profiles), so we join via users
  const { data, error } = await window.sb
    .from('student_profiles')
    .select(`
      *,
      users:user_id (
        id, full_name, email, created_at,
        projects (id, title, tech_stack, demo_link, github_link, description, created_at)
      )
    `);

  if (loadingEl) loadingEl.classList.add('hidden');

  if (error) { showToast('Failed to load students', 'error'); return; }

  allStudents = (data || []).map(sp => ({
    profileId: sp.id,
    userId: sp.user_id,
    fullName: sp.users?.full_name || 'Anonymous',
    email: sp.users?.email || '',
    headline: sp.headline || '',
    bio: sp.bio || '',
    location: sp.location || '',
    availability: sp.availability || '',
    skills: sp.skills || [],
    joinedAt: sp.users?.created_at || '',
    projects: sp.users?.projects || []
  }));

  document.getElementById('student-count').textContent = allStudents.length;
  renderStudents(allStudents);
}

// ── RENDER STUDENTS ───────────────────────────────────────
function renderStudents(students) {
  const grid = document.getElementById('students-grid');
  const empty = document.getElementById('students-empty');

  if (!students.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = students.map(s => `
    <div class="student-card animate-fade-up" onclick="openStudentProfile('${s.userId}')">
      <div class="student-card__top">
        <div class="student-avatar">${getInitials(s.fullName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(s.fullName)}</h3>
          <p class="student-card__headline">${escHtml(s.headline)}</p>
        </div>
        <button class="shortlist-btn ${shortlist.includes(s.userId) ? 'shortlisted' : ''}"
          onclick="event.stopPropagation();toggleShortlist('${s.userId}')"
          title="${shortlist.includes(s.userId) ? 'Remove from shortlist' : 'Add to shortlist'}">
          ${shortlist.includes(s.userId) ? '★' : '☆'}
        </button>
      </div>
      ${s.location ? `<p class="student-card__loc">📍 ${escHtml(s.location)}</p>` : ''}
      <div class="student-card__skills">
        ${s.skills.slice(0, 5).map(sk => `<span class="skill-chip">${escHtml(sk)}</span>`).join('')}
        ${s.skills.length > 5 ? `<span class="skill-chip skill-chip--more">+${s.skills.length - 5}</span>` : ''}
      </div>
      <div class="student-card__footer">
        <span class="avail-badge avail-badge--${availColor(s.availability)}">${s.availability || 'unknown'}</span>
        <span class="proj-count">${s.projects.length} project${s.projects.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--sm btn--ghost" onclick="event.stopPropagation();openStudentProfile('${s.userId}')">View profile</button>
      </div>
    </div>
  `).join('');
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function availColor(av) {
  if (av === 'available') return 'green';
  if (av === 'open') return 'amber';
  return 'grey';
}

// ── STUDENT PROFILE MODAL ─────────────────────────────────
function openStudentProfile(userId) {
  const student = allStudents.find(s => s.userId === userId);
  if (!student) return;

  const modal = document.getElementById('student-modal');
  const content = document.getElementById('student-modal-content');

  content.innerHTML = `
    <div class="student-modal__header">
      <div class="student-avatar student-avatar--lg">${getInitials(student.fullName)}</div>
      <div>
        <h2>${escHtml(student.fullName)}</h2>
        <p class="student-modal__headline">${escHtml(student.headline)}</p>
        ${student.location ? `<p class="student-modal__loc">📍 ${escHtml(student.location)}</p>` : ''}
        <span class="avail-badge avail-badge--${availColor(student.availability)}">${student.availability || 'Not set'}</span>
      </div>
    </div>
    ${student.bio ? `<div class="student-modal__bio"><h4>About</h4><p>${escHtml(student.bio)}</p></div>` : ''}
    <div class="student-modal__skills">
      <h4>Skills</h4>
      <div class="skill-chips-row">
        ${student.skills.map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('') || '<span class="muted">No skills listed</span>'}
      </div>
    </div>
    <div class="student-modal__projects">
      <h4>Projects (${student.projects.length})</h4>
      ${student.projects.length ? student.projects.map(p => `
        <div class="modal-project-card">
          <div class="modal-project-card__head">
            <strong>${escHtml(p.title)}</strong>
            <span class="project-date">${fmtDate(p.created_at)}</span>
          </div>
          <p class="project-card__desc">${escHtml(p.description || '')}</p>
          <div class="project-card__skills">
            ${(p.tech_stack || []).map(s => `<span class="skill-chip skill-chip--sm">${escHtml(s)}</span>`).join('')}
          </div>
          <div class="project-card__links">
            ${p.demo_link ? `<a class="project-link" href="${escHtml(p.demo_link)}" target="_blank" rel="noopener">🔗 Live</a>` : ''}
            ${p.github_link ? `<a class="project-link" href="${escHtml(p.github_link)}" target="_blank" rel="noopener">⌥ GitHub</a>` : ''}
          </div>
        </div>
      `).join('') : '<p class="muted">No projects yet</p>'}
    </div>
    <div class="student-modal__actions">
      <a href="mailto:${escHtml(student.email)}" class="btn btn--primary">✉ Contact ${escHtml(student.fullName.split(' ')[0])}</a>
      <button class="btn btn--outline" onclick="toggleShortlist('${student.userId}');updateShortlistBtn('${student.userId}',this)">
        ${shortlist.includes(student.userId) ? '★ Shortlisted' : '☆ Shortlist'}
      </button>
    </div>
  `;

  modal.classList.remove('hidden');
}

function updateShortlistBtn(userId, btn) {
  btn.textContent = shortlist.includes(userId) ? '★ Shortlisted' : '☆ Shortlist';
}

function closeStudentModal() {
  document.getElementById('student-modal').classList.add('hidden');
}

// ── SHORTLIST ─────────────────────────────────────────────
function toggleShortlist(userId) {
  const idx = shortlist.indexOf(userId);
  if (idx > -1) { shortlist.splice(idx, 1); showToast('Removed from shortlist', 'warn'); }
  else { shortlist.push(userId); showToast('Added to shortlist ★', 'success'); }
  renderStudents(getFilteredStudents());
  renderShortlist();
}

function renderShortlist() {
  const grid = document.getElementById('shortlist-grid');
  const empty = document.getElementById('shortlist-empty');
  const count = document.getElementById('shortlist-count');
  if (!grid) return;

  count.textContent = shortlist.length;
  const shortlisted = allStudents.filter(s => shortlist.includes(s.userId));

  if (!shortlisted.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = shortlisted.map(s => `
    <div class="student-card animate-fade-up" onclick="openStudentProfile('${s.userId}')">
      <div class="student-card__top">
        <div class="student-avatar">${getInitials(s.fullName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(s.fullName)}</h3>
          <p class="student-card__headline">${escHtml(s.headline)}</p>
        </div>
        <button class="shortlist-btn shortlisted" onclick="event.stopPropagation();toggleShortlist('${s.userId}')">★</button>
      </div>
      <div class="student-card__footer">
        <a href="mailto:${escHtml(s.email)}" class="btn btn--sm btn--primary" onclick="event.stopPropagation()">✉ Contact</a>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--sm btn--ghost" onclick="event.stopPropagation();openStudentProfile('${s.userId}')">View profile</button>
      </div>
    </div>
  `).join('');
}

// ── SEARCH & FILTERS ──────────────────────────────────────
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFilters());
  }
  const locFilter = document.getElementById('filter-location');
  if (locFilter) locFilter.addEventListener('input', () => applyFilters());
  const availFilter = document.getElementById('filter-availability');
  if (availFilter) availFilter.addEventListener('change', () => applyFilters());
}

function getFilteredStudents() {
  const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const loc = document.getElementById('filter-location')?.value || '';
  const avail = document.getElementById('filter-availability')?.value || '';

  return allStudents.filter(s => {
    if (q && !s.fullName.toLowerCase().includes(q) && !s.headline.toLowerCase().includes(q) && !s.skills.some(sk => sk.toLowerCase().includes(q))) return false;
    if (loc && !s.location.toLowerCase().includes(loc.toLowerCase())) return false;
    if (avail && s.availability !== avail) return false;
    if (filterSkills.length && !filterSkills.every(fs => s.skills.some(sk => sk.toLowerCase() === fs.toLowerCase()))) return false;
    return true;
  });
}

function applyFilters() {
  renderStudents(getFilteredStudents());
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-location').value = '';
  document.getElementById('filter-availability').value = '';
  filterSkills.length = 0;
  document.getElementById('filter-skills-wrap').querySelectorAll('.skill-tag').forEach(t => t.remove());
  renderStudents(allStudents);
}

// ── SECTION NAV ───────────────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

  if (section === 'shortlist') renderShortlist();
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', initRecruiter);