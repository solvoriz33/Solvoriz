// ============================================================
// STUDENT.JS — Student dashboard logic
// ============================================================

let currentUser = null;
let currentProfile = null;
let myProjects = [];
let profileSkills = [];
let projectSkills = [];
let editProjectSkills = [];
let editingProjectId = null;

// ── INIT ─────────────────────────────────────────────────
async function initStudent() {
  const result = await requireAuth('student');
  if (!result) return;

  currentUser = result.session.user;
  currentProfile = result.profile;

  document.getElementById('user-name').textContent = currentProfile.full_name || currentUser.email;
  document.getElementById('user-email').textContent = currentUser.email;
  const initials = (currentProfile.full_name || currentUser.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent = initials;

  initForms();
  await loadStudentProfile();
  await loadProjects();
  // Set overview name reliably (not via setTimeout in HTML)
  const ovName = document.getElementById('overview-name');
  if (ovName) ovName.textContent = currentProfile.full_name || currentUser.email;
  showSection('overview');
}

// ── LOAD STUDENT PROFILE ─────────────────────────────────
async function loadStudentProfile() {
  const { data, error } = await window.sb
    .from('student_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  if (data) {
    currentProfile = { ...currentProfile, ...data };
    populateProfileForm(data);
    updateOverviewCard(data);
  }
}

function populateProfileForm(profile) {
  const fields = ['headline', 'bio', 'location', 'availability'];
  fields.forEach(f => {
    const el = document.getElementById(`profile-${f}`);
    if (el && profile[f]) el.value = profile[f];
  });

  // Populate skills
  profileSkills.length = 0;
  document.getElementById('profile-skills-wrap')
    .querySelectorAll('.skill-tag').forEach(t => t.remove());

  if (profile.skills?.length) {
    profile.skills.forEach(s => profileSkillsInput?.addSkillTag(s));
  }
}

function updateOverviewCard(profile) {
  const el = document.getElementById('overview-headline');
  if (el) el.textContent = profile.headline || 'No headline yet';
  const loc = document.getElementById('overview-location');
  if (loc) loc.textContent = profile.location ? `📍 ${profile.location}` : '📍 —';
  const avail = document.getElementById('overview-availability');
  if (avail) {
    avail.textContent = profile.availability || 'Not set';
    avail.className = `avail-badge ${profile.availability === 'available' ? 'avail-badge--green' : profile.availability === 'open' ? 'avail-badge--amber' : 'avail-badge--grey'}`;
  }
  const skillsCount = document.getElementById('skills-count');
  if (skillsCount) skillsCount.textContent = (profile.skills || []).length;
}

// ── LOAD PROJECTS ─────────────────────────────────────────
async function loadProjects() {
  const { data, error } = await window.sb
    .from('projects')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to load projects', 'error'); return; }
  myProjects = data || [];

  document.getElementById('project-count').textContent = myProjects.length;
  renderProjects();
}

function renderProjects() {
  const grid = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');

  if (!myProjects.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = myProjects.map(p => `
    <div class="project-card animate-fade-up" data-id="${p.id}">
      <div class="project-card__header">
        <h3 class="project-card__title">${escHtml(p.title)}</h3>
        <div class="project-card__actions">
          <button class="icon-btn" title="Edit" onclick="openEditProject('${p.id}')">✏</button>
          <button class="icon-btn icon-btn--danger" title="Delete" onclick="deleteProject('${p.id}')">🗑</button>
        </div>
      </div>
      <p class="project-card__desc">${escHtml(p.description || '')}</p>
      <div class="project-card__skills">
        ${(p.tech_stack || []).map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('')}
      </div>
      <div class="project-card__links">
        ${p.demo_link ? `<a class="project-link" href="${escHtml(p.demo_link)}" target="_blank" rel="noopener">🔗 Live Demo</a>` : ''}
        ${p.github_link ? `<a class="project-link" href="${escHtml(p.github_link)}" target="_blank" rel="noopener">⌥ GitHub</a>` : ''}
      </div>
      <div class="project-card__footer">
        <span class="project-date">${fmtDate(p.created_at)}</span>
      </div>
    </div>
  `).join('');
}

// ── SECTION NAVIGATION ───────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const sectionEl = document.getElementById(`section-${section}`);
  const navEl = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (sectionEl) sectionEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
}

// ── FORMS ────────────────────────────────────────────────
let profileSkillsInput = null;
let addProjectSkillsInput = null;
let editProjectSkillsInput = null;

function initForms() {
  profileSkillsInput = initSkillInput({
    wrapId: 'profile-skills-wrap',
    inputId: 'profile-skill-input',
    suggestId: 'profile-skill-suggest',
    arr: profileSkills,
    max: 20
  });

  addProjectSkillsInput = initSkillInput({
    wrapId: 'add-proj-skills-wrap',
    inputId: 'add-proj-skill-input',
    suggestId: 'add-proj-skill-suggest',
    arr: projectSkills,
    max: 10
  });

  editProjectSkillsInput = initSkillInput({
    wrapId: 'edit-proj-skills-wrap',
    inputId: 'edit-proj-skill-input',
    suggestId: 'edit-proj-skill-suggest',
    arr: editProjectSkills,
    max: 10
  });
}

// ── SAVE PROFILE ─────────────────────────────────────────
async function saveProfile(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Saving...');

  const payload = {
    user_id: currentUser.id,
    headline: document.getElementById('profile-headline').value.trim(),
    bio: document.getElementById('profile-bio').value.trim(),
    location: document.getElementById('profile-location').value.trim(),
    availability: document.getElementById('profile-availability').value,
    skills: [...profileSkills]
  };

  const { data: existing } = await window.sb
    .from('student_profiles')
    .select('id')
    .eq('user_id', currentUser.id)
    .single();

  let error;
  if (existing) {
    ({ error } = await window.sb.from('student_profiles').update(payload).eq('user_id', currentUser.id));
  } else {
    ({ error } = await window.sb.from('student_profiles').insert(payload));
  }

  setBtnLoading(btn, false);
  if (error) { showToast('Failed to save profile: ' + error.message, 'error'); return; }
  showToast('Profile saved!', 'success');
  await loadStudentProfile();
  showSection('overview');
}

// ── ADD PROJECT ──────────────────────────────────────────
async function addProject(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Adding...');

  const payload = {
    user_id: currentUser.id,
    title: document.getElementById('proj-title').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    tech_stack: [...projectSkills],
    demo_link: document.getElementById('proj-demo').value.trim() || null,
    github_link: document.getElementById('proj-github').value.trim() || null
  };

  const { error } = await window.sb.from('projects').insert(payload);
  setBtnLoading(btn, false);

  if (error) { showToast('Failed to add project: ' + error.message, 'error'); return; }
  showToast('Project added!', 'success');
  e.target.reset();
  projectSkills.length = 0;
  document.getElementById('add-proj-skills-wrap').querySelectorAll('.skill-tag').forEach(t => t.remove());
  await loadProjects();
  showSection('projects');
}

// ── EDIT PROJECT ─────────────────────────────────────────
function openEditProject(id) {
  const project = myProjects.find(p => p.id === id);
  if (!project) return;
  editingProjectId = id;

  document.getElementById('edit-proj-title').value = project.title || '';
  document.getElementById('edit-proj-desc').value = project.description || '';
  document.getElementById('edit-proj-demo').value = project.demo_link || '';
  document.getElementById('edit-proj-github').value = project.github_link || '';

  editProjectSkills.length = 0;
  document.getElementById('edit-proj-skills-wrap').querySelectorAll('.skill-tag').forEach(t => t.remove());
  (project.tech_stack || []).forEach(s => editProjectSkillsInput?.addSkillTag(s));

  document.getElementById('edit-project-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-project-modal').classList.add('hidden');
  editingProjectId = null;
}

async function saveEditProject(e) {
  e.preventDefault();
  if (!editingProjectId) return;
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Saving...');

  const payload = {
    title: document.getElementById('edit-proj-title').value.trim(),
    description: document.getElementById('edit-proj-desc').value.trim(),
    tech_stack: [...editProjectSkills],
    demo_link: document.getElementById('edit-proj-demo').value.trim() || null,
    github_link: document.getElementById('edit-proj-github').value.trim() || null
  };

  const { error } = await window.sb.from('projects').update(payload).eq('id', editingProjectId);
  setBtnLoading(btn, false);

  if (error) { showToast('Failed to update: ' + error.message, 'error'); return; }
  showToast('Project updated!', 'success');
  closeEditModal();
  await loadProjects();
}

// ── DELETE PROJECT ───────────────────────────────────────
async function deleteProject(id) {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  const { error } = await window.sb.from('projects').delete().eq('id', id);
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }
  showToast('Project deleted', 'warn');
  await loadProjects();
}

// ── LOGOUT ───────────────────────────────────────────────
async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

// ── BOOT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initStudent);