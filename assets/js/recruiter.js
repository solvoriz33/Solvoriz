// ============================================================
// RECRUITER.JS — Recruiter dashboard logic
// ============================================================

let currentUser = null;
let currentProfile = null;
let allStudents = [];
let myNotifications = [];
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

  if (!currentProfile.verified_recruiter) {
    showToast('Your recruiter account is pending verification. Contact an admin to unlock full access.', 'warn');
  }

  filterSkillsInput = initSkillInput({
    wrapId: 'filter-skills-wrap',
    inputId: 'filter-skill-input',
    suggestId: 'filter-skill-suggest',
    arr: filterSkills,
    max: 10,
    onChange: () => applyFilters()
  });

  await Promise.all([loadStudents(), loadNotifications()]);
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
    age: sp.age || null,
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
          ${s.age ? `<span class="student-card__loc">🎂 Age ${escHtml(String(s.age))}</span>` : ''}
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
      <textarea id="contact-message" class="textarea" placeholder="Write a short message to introduce yourself and why you'd like to connect." rows="4"></textarea>
      <button class="btn btn--primary" onclick="sendContactRequest('${student.userId}')">✉ Send contact request</button>
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

async function sendContactRequest(studentId) {
  if (!currentProfile.verified_recruiter) {
    showToast('You must be a verified recruiter to send contact requests.', 'error');
    return;
  }

  const message = document.getElementById('contact-message')?.value.trim();
  if (!message) {
    showToast('Please write a short message before sending.', 'error');
    return;
  }

  const { error } = await window.sb.from('contact_requests').insert({
    recruiter_id: currentUser.id,
    student_id: studentId,
    message,
  });

  if (error) {
    showToast('Failed to send contact request: ' + error.message, 'error');
    return;
  }

  await createNotification(studentId, 'contact_request', {
    recruiter_id: currentUser.id,
    recruiter_name: currentProfile.full_name,
    message
  });

  showToast('Contact request sent!', 'success');
  closeStudentModal();
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
          ${s.age ? `<span class="student-card__loc">🎂 Age ${escHtml(String(s.age))}</span>` : ''}
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

async function loadNotifications() {
  const { data, error } = await window.sb
    .from('notifications')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { showToast('Failed to load notifications', 'error'); return; }
  myNotifications = data || [];
  renderNotifications();
}

function renderNotifications() {
  const list = document.getElementById('notifications-list');
  const empty = document.getElementById('notifications-empty');
  const count = document.getElementById('notification-count');
  if (count) count.textContent = String(myNotifications.length || 0);
  if (!list) return;
  if (!myNotifications.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');
  list.innerHTML = myNotifications.map(note => {
    const title = note.type === 'contact_request'
      ? 'New contact request'
      : note.type === 'project_feature'
        ? `Project ${note.payload?.featured ? 'featured' : 'updated'}`
        : note.type === 'recruiter_verified'
          ? 'Recruiter status updated'
          : 'Notification';
    const body = note.payload?.message || note.payload?.title || note.payload?.detail || 'You have a new update.';
    return `
      <div class="card notification-card animate-fade-up">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><strong>${escHtml(title)}</strong><div class="muted" style="margin-top:6px">${escHtml(body)}</div></div>
          <span class="role-badge role-badge--grey">${fmtDate(note.created_at)}</span>
        </div>
      </div>
    `;
  }).join('');
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
  const projectType = document.getElementById('filter-project-type');
  if (projectType) projectType.addEventListener('change', () => applyFilters());
  const ageMin = document.getElementById('filter-age-min');
  const ageMax = document.getElementById('filter-age-max');
  if (ageMin) ageMin.addEventListener('input', () => applyFilters());
  if (ageMax) ageMax.addEventListener('input', () => applyFilters());
}

function getFilteredStudents() {
  const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const loc = document.getElementById('filter-location')?.value || '';
  const avail = document.getElementById('filter-availability')?.value || '';
  const type = document.getElementById('filter-project-type')?.value || '';
  const minAge = parseInt(document.getElementById('filter-age-min')?.value, 10);
  const maxAge = parseInt(document.getElementById('filter-age-max')?.value, 10);

  return allStudents.filter(s => {
    if (q && !s.fullName.toLowerCase().includes(q) && !s.headline.toLowerCase().includes(q) && !s.skills.some(sk => sk.toLowerCase().includes(q))) return false;
    if (loc && !s.location.toLowerCase().includes(loc.toLowerCase())) return false;
    if (avail && s.availability !== avail) return false;
    if (type && !s.projects.some(p => p.project_type === type)) return false;
    if (!Number.isNaN(minAge) && (s.age === null || s.age < minAge)) return false;
    if (!Number.isNaN(maxAge) && (s.age === null || s.age > maxAge)) return false;
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
  document.getElementById('filter-age-min').value = '';
  document.getElementById('filter-age-max').value = '';
  document.getElementById('filter-availability').value = '';
  document.getElementById('filter-project-type').value = '';
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
  if (section === 'notifications') renderNotifications();
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', initRecruiter);