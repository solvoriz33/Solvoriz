// ============================================================
// RECRUITER.JS — Recruiter dashboard logic
// ============================================================

let currentUser = null;
let currentProfile = null;
let allProjects = [];
let allStudents = []; // Keep for context
let myNotifications = [];
let myMessages = [];
let filterSkills = [];
let shortlistProjectIds = []; // DB-persisted shortlist
let filterSkillsInput = null;
let currentConversation = null;

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

  await Promise.all([loadAllProjects(), loadShortlist(), loadNotifications(), loadMessages()]);
  setupSearch();
  updateDashboardStats();
  showSection('browse');
}

// ── LOAD ALL PROJECTS (Browse by projects, not profiles) ──
async function loadAllProjects() {
  const loadingEl = document.getElementById('students-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');

  const { data, error } = await window.sb
    .from('projects')
    .select(`
      *,
      users:user_id (
        id, full_name, email,
        student_profiles (headline, bio, location, age, availability, skills)
      )
    `)
    .eq('visible', true)
    .eq('review_status', 'active')
    .order('created_at', { ascending: false });

  if (loadingEl) loadingEl.classList.add('hidden');

  if (error) { showToast('Failed to load projects', 'error'); return; }

  allProjects = (data || []).map(p => ({
    id: p.id,
    userId: p.user_id,
    title: p.title,
    description: p.description || '',
    tech_stack: p.tech_stack || [],
    project_type: p.project_type || 'Side Project',
    image_url: p.image_url || '',
    demo_link: p.demo_link || '',
    github_link: p.github_link || '',
    created_at: p.created_at,
    builderName: p.users?.full_name || 'Anonymous',
    builderEmail: p.users?.email || '',
    builderHeadline: p.users?.student_profiles?.[0]?.headline || '',
    builderLocation: p.users?.student_profiles?.[0]?.location || '',
    builderAge: p.users?.student_profiles?.[0]?.age || null,
    builderAvailability: p.users?.student_profiles?.[0]?.availability || '',
    builderSkills: p.users?.student_profiles?.[0]?.skills || []
  }));

  document.getElementById('student-count').textContent = allProjects.length;
  renderProjects(allProjects);
}

// ── LOAD SHORTLIST FROM DB ────────────────────────────────
async function loadShortlist() {
  const { data, error } = await window.sb
    .from('shortlists')
    .select('project_id')
    .eq('recruiter_id', currentUser.id);

  if (error) { showToast('Failed to load shortlist', 'error'); return; }
  shortlistProjectIds = (data || []).map(s => s.project_id);
  renderShortlist();
  updateShortlistCount();
}

// ── RENDER PROJECTS ──────────────────────────────────────
function renderProjects(projects) {
  const grid = document.getElementById('students-grid');
  const empty = document.getElementById('students-empty');

  if (!projects.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = projects.map(p => {
    const isShortlisted = shortlistProjectIds.includes(p.id);
    return `
      <div class="student-card animate-fade-up">
        <div class="student-card__top">
          <div class="student-avatar">${getInitials(p.builderName)}</div>
          <div class="student-card__info">
            <h3 class="student-card__name">${escHtml(p.title)}</h3>
            <p class="student-card__headline">${escHtml(p.builderName)}</p>
            <div class="student-card__meta">
              <span style="font-size:.9rem;color:var(--ink-2)">${escHtml(p.project_type)}</span>
            </div>
          </div>
          <button class="shortlist-btn ${isShortlisted ? 'shortlisted' : ''}" 
            onclick="event.stopPropagation();toggleShortlist('${p.id}')"
            title="${isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}">★</button>
        </div>
        <p style="font-size:.95rem;color:var(--ink-2);margin:12px 0">${escHtml(p.description.slice(0, 100))}${p.description.length > 100 ? '...' : ''}</p>
        <div class="project-card__skills" style="margin:12px 0">
          ${(p.tech_stack || []).slice(0, 4).map(s => `<span class="skill-chip skill-chip--sm">${escHtml(s)}</span>`).join('')}
        </div>
        <div class="student-card__footer">
          ${p.builderLocation ? `<span style="font-size:.9rem">📍 ${escHtml(p.builderLocation)}</span>` : ''}
          ${p.builderAvailability ? `<span class="role-badge role-badge--sm role-badge--${p.builderAvailability === 'available' ? 'success' : 'grey'}">${escHtml(p.builderAvailability)}</span>` : ''}
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--primary" onclick="event.stopPropagation();openProjectDetail('${p.id}')">View project</button>
          <button class="btn btn--sm btn--outline" onclick="event.stopPropagation();contactBuilder('${p.userId}','${p.id}')">Send message</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── OPEN PROJECT DETAIL MODAL ─────────────────────────────
function openProjectDetail(projectId) {
  const project = allProjects.find(p => p.id === projectId);
  if (!project) return;

  // Log activity
  logActivity('project_view', 'project', projectId, project.userId);

  const modal = document.getElementById('student-modal');
  const content = document.getElementById('student-modal-content');
  if (!modal || !content) return;

  const isShortlisted = shortlistProjectIds.includes(project.id);

  content.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2>${escHtml(project.title)}</h2>
        <p class="muted">${escHtml(project.builderName)}</p>
        <p class="muted">${escHtml(project.project_type)}</p>
      </div>
      <button class="shortlist-btn ${isShortlisted ? 'shortlisted' : ''}" 
        onclick="toggleShortlist('${project.id}');renderProjectDetail('${projectId}')"
        title="${isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}">★</button>
    </div>
    ${project.image_url ? `<div style="background-image:url('${escHtml(project.image_url)}');margin-top:16px;height:200px;background-size:cover;background-position:center;border-radius:12px"></div>` : ''}
    <div style="margin-top:18px">
      <h3 style="margin-bottom:8px">About this project</h3>
      <p>${escHtml(project.description)}</p>
    </div>
    <div style="margin-top:16px">
      <h3 style="margin-bottom:8px">Tech stack</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${(project.tech_stack || []).map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('')}
      </div>
    </div>
    <div style="margin-top:16px">
      <h3 style="margin-bottom:8px">Builder profile</h3>
      <div style="padding:12px;background:var(--bg-2);border-radius:8px">
        <p><strong>${escHtml(project.builderName)}</strong></p>
        <p class="muted">${escHtml(project.builderEmail)}</p>
        ${project.builderHeadline ? `<p style="margin-top:4px">${escHtml(project.builderHeadline)}</p>` : ''}
        ${project.builderLocation ? `<p style="margin-top:4px;color:var(--ink-2)">📍 ${escHtml(project.builderLocation)}</p>` : ''}
        ${project.builderAge ? `<p style="margin-top:4px;color:var(--ink-2)">Age: ${project.builderAge}</p>` : ''}
      </div>
    </div>
    <div class="project-card__links" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      ${project.demo_link ? `<a class="project-link" href="${escHtml(project.demo_link)}" target="_blank" rel="noopener">🔗 Live Demo</a>` : ''}
      ${project.github_link ? `<a class="project-link" href="${escHtml(project.github_link)}" target="_blank" rel="noopener">⌥ GitHub</a>` : ''}
    </div>
    <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn--primary" onclick="contactBuilder('${project.userId}','${project.id}')">Send message</button>
      <button class="btn btn--outline" onclick="closeStudentModal()">Close</button>
    </div>
  `;

  modal.classList.remove('hidden');
}

function renderProjectDetail(projectId) {
  openProjectDetail(projectId);
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function closeStudentModal() {
  document.getElementById('student-modal').classList.add('hidden');
}

// ── SEND CONTACT REQUEST ─────────────────────────────────
async function contactBuilder(studentId, projectId) {
  if (!currentProfile.verified_recruiter) {
    showToast('You must be a verified recruiter to send messages.', 'error');
    return;
  }

  const message = prompt('Write your message to this builder (max 500 characters):');
  if (!message || !message.trim()) return;

  const truncated = message.trim().slice(0, 500);

  // Ensure a conversation exists
  let conv = null;
  const { data: existing } = await window.sb.from('conversations').select('*')
    .eq('recruiter_id', currentUser.id).eq('student_id', studentId).eq('project_id', projectId || null).limit(1);
  if (existing && existing.length) conv = existing[0];
  if (!conv) {
    const { data: created, error: cErr } = await window.sb.from('conversations').insert({
      recruiter_id: currentUser.id,
      student_id: studentId,
      project_id: projectId || null
    }).select().single();
    if (cErr) { showToast('Failed to start conversation: ' + cErr.message, 'error'); return; }
    conv = created;
  }

  // Insert message into messages table
  const { error: mErr } = await window.sb.from('messages').insert({
    conversation_id: conv.id,
    sender_id: currentUser.id,
    body: truncated
  });
  if (mErr) { showToast('Failed to send message: ' + mErr.message, 'error'); return; }

  // Create notification for the builder
  await createNotification(studentId, 'contact_request', {
    recruiter_id: currentUser.id,
    recruiter_name: currentProfile.full_name || currentUser.email,
    message: truncated,
    project_id: projectId || null
  });

  // Log activity
  logActivity('contact_sent', 'project', projectId || null, studentId);

  showToast('Message sent! 📬', 'success');
  closeStudentModal();
  await loadMessages();
}

// ── CONVERSATIONS & CHAT ─────────────────────────────────
async function loadMessages() {
  const { data, error } = await window.sb
    .from('conversations')
    .select(`*, student:student_id(id, full_name, email), last_message:messages (id, body, created_at, sender_id)`)
    .eq('recruiter_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to load messages', 'error'); return; }
  myMessages = data || [];
  renderConversations();
}

function renderConversations() {
  const threads = document.getElementById('messages-threads');
  const empty = document.getElementById('messages-empty');
  const navCount = document.getElementById('message-count');
  if (navCount) navCount.textContent = String(myMessages.length || 0);
  if (!threads) return;
  if (!myMessages.length) { threads.innerHTML = ''; if (empty) empty.classList.remove('hidden'); return; }
  if (empty) empty.classList.add('hidden');
  threads.innerHTML = myMessages.map(c => {
    const last = (c.last_message && c.last_message[0]) || {};
    return `
      <div class="card" style="padding:10px;cursor:pointer" onclick="openConversation('${c.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${escHtml(c.student?.full_name || c.student?.email || 'Builder')}</strong>
            <div class="muted" style="margin-top:6px">${escHtml(last.body || 'No messages yet')}</div>
          </div>
          <div class="muted" style="font-size:.8rem">${fmtDate(last.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

async function openConversation(convId) {
  currentConversation = convId;
  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return;
  document.getElementById('chat-title').textContent = conv.student?.full_name || conv.student?.email || 'Builder';
  document.getElementById('chat-meta').textContent = conv.project_id ? (`Project: ${conv.project_id}`) : '';
  await loadConversationMessages(convId);
  document.getElementById('chat-send-btn').onclick = sendRecruiterMessage;
}

async function loadConversationMessages(convId) {
  const { data, error } = await window.sb.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
  if (error) { showToast('Failed to load thread', 'error'); return; }
  const pane = document.getElementById('chat-messages');
  pane.innerHTML = (data || []).map(m => `
    <div style="display:flex;flex-direction:column;align-items:${m.sender_id === currentUser.id ? 'flex-end' : 'flex-start'}">
      <div style="background:${m.sender_id === currentUser.id ? 'var(--accent)' : 'var(--bg-1)'};color:${m.sender_id === currentUser.id ? '#fff' : 'inherit'};padding:8px;border-radius:8px;max-width:70%">${escHtml(m.body)}</div>
      <div class="muted" style="font-size:.75rem;margin-top:4px">${fmtDate(m.created_at)}</div>
    </div>
  `).join('');
  pane.scrollTop = pane.scrollHeight;
}

async function sendRecruiterMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || !currentConversation) return;
  const body = input.value.trim().slice(0,1000);
  const { error } = await window.sb.from('messages').insert({ conversation_id: currentConversation, sender_id: currentUser.id, body });
  if (error) { showToast('Failed to send', 'error'); return; }
  input.value = '';
  await loadConversationMessages(currentConversation);
  // Optionally notify other party
}

// ── SHORTLIST (DB-PERSISTED) ──────────────────────────────
async function toggleShortlist(projectId) {
  const isShortlisted = shortlistProjectIds.includes(projectId);

  if (isShortlisted) {
    // Remove from shortlist
    const { error } = await window.sb
      .from('shortlists')
      .delete()
      .eq('recruiter_id', currentUser.id)
      .eq('project_id', projectId);

    if (error) { showToast('Failed to update shortlist: ' + error.message, 'error'); return; }
    shortlistProjectIds = shortlistProjectIds.filter(id => id !== projectId);
    showToast('Removed from shortlist', 'warn');
  } else {
    // Add to shortlist
    const { error } = await window.sb
      .from('shortlists')
      .insert({
        recruiter_id: currentUser.id,
        project_id: projectId
      });

    if (error) { showToast('Failed to update shortlist: ' + error.message, 'error'); return; }
    shortlistProjectIds.push(projectId);
    showToast('Added to shortlist ★', 'success');

    // Log activity
    logActivity('shortlist', 'project', projectId, allProjects.find(p => p.id === projectId)?.userId);
  }

  renderProjects(getFilteredProjects());
  updateShortlistCount();
  renderShortlist();
  updateDashboardStats();
}

function updateShortlistCount() {
  const count = document.getElementById('shortlist-count');
  if (count) count.textContent = shortlistProjectIds.length;
}

function renderShortlist() {
  const grid = document.getElementById('shortlist-grid');
  const empty = document.getElementById('shortlist-empty');
  if (!grid) return;

  const shortlisted = allProjects.filter(p => shortlistProjectIds.includes(p.id));

  if (!shortlisted.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = shortlisted.map(p => `
    <div class="student-card animate-fade-up">
      <div class="student-card__top">
        <div class="student-avatar">${getInitials(p.builderName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(p.title)}</h3>
          <p class="student-card__headline">${escHtml(p.builderName)}</p>
        </div>
        <button class="shortlist-btn shortlisted" onclick="event.stopPropagation();toggleShortlist('${p.id}')">★</button>
      </div>
      <div class="student-card__footer">
        <span class="role-badge role-badge--grey">${escHtml(p.project_type)}</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--sm btn--primary" onclick="openProjectDetail('${p.id}')">View project</button>
        <button class="btn btn--sm btn--outline" onclick="contactBuilder('${p.userId}','${p.id}')">Send message</button>
      </div>
    </div>
  `).join('');
}

// ── ACTIVITY LOGGING ──────────────────────────────────────
async function logActivity(actionType, targetType, targetId, targetUserId) {
  if (!targetUserId) return;
  const { error } = await window.sb.from('activity_log').insert({
    actor_id: currentUser.id,
    action_type: actionType,
    target_type: targetType,
    target_id: targetId,
    target_user_id: targetUserId
  });
  if (error) console.warn('Activity log failed:', error);
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

async function loadMessages() {
  const { data, error } = await window.sb
    .from('contact_requests')
    .select(`*, student:student_id (id, full_name, email), project:project_id (id, title)`)
    .eq('recruiter_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to load messages', 'error'); return; }
  myMessages = data || [];
  renderMessages();
}

function renderMessages() {
  const list = document.getElementById('messages-list');
  const empty = document.getElementById('messages-empty');
  const count = document.getElementById('message-count');
  const dashboardCount = document.getElementById('dashboard-message-count');
  if (count) count.textContent = String(myMessages.length || 0);
  if (dashboardCount) dashboardCount.textContent = String(myMessages.length || 0);
  if (!list) return;

  if (!myMessages.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');
  list.innerHTML = myMessages.map(msg => `
    <div class="card notification-card animate-fade-up">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <strong>💬 Message to ${escHtml(msg.student?.full_name || msg.student?.email || 'Builder')}</strong>
          <div class="muted" style="margin-top:6px">${escHtml(msg.project?.title || 'Project message')}</div>
          <div style="margin-top:8px;padding:10px;background:var(--bg-2);border-radius:6px;font-size:.95rem">
            ${escHtml(msg.message)}
          </div>
        </div>
        <span class="role-badge role-badge--grey">${fmtDate(msg.created_at)}</span>
      </div>
    </div>
  `).join('');
}

function updateDashboardStats() {
  const projectCount = document.getElementById('dashboard-project-count');
  const shortlistCount = document.getElementById('dashboard-shortlist-count');
  const messageCount = document.getElementById('dashboard-message-count');
  if (projectCount) projectCount.textContent = String(allProjects.length);
  if (shortlistCount) shortlistCount.textContent = String(shortlistProjectIds.length);
  if (messageCount) messageCount.textContent = String(myMessages.length);
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

function getFilteredProjects() {
  const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const loc = document.getElementById('filter-location')?.value || '';
  const avail = document.getElementById('filter-availability')?.value || '';
  const type = document.getElementById('filter-project-type')?.value || '';
  const minAge = parseInt(document.getElementById('filter-age-min')?.value, 10);
  const maxAge = parseInt(document.getElementById('filter-age-max')?.value, 10);

  return allProjects.filter(p => {
    if (q && !p.title.toLowerCase().includes(q) && !p.builderName.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q) && !p.tech_stack.some(sk => sk.toLowerCase().includes(q))) return false;
    if (loc && !p.builderLocation.toLowerCase().includes(loc.toLowerCase())) return false;
    if (avail && p.builderAvailability !== avail) return false;
    if (type && p.project_type !== type) return false;
    if (!Number.isNaN(minAge) && (p.builderAge === null || p.builderAge < minAge)) return false;
    if (!Number.isNaN(maxAge) && (p.builderAge === null || p.builderAge > maxAge)) return false;
    if (filterSkills.length && !filterSkills.every(fs => p.tech_stack.some(sk => sk.toLowerCase() === fs.toLowerCase()))) return false;
    return true;
  });
}

function applyFilters() {
  renderProjects(getFilteredProjects());
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
  renderProjects(allProjects);
}


// ── SECTION NAV ───────────────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

  if (section === 'shortlist') renderShortlist();
  if (section === 'notifications') renderNotifications();
  if (section === 'messages') renderMessages();
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', initRecruiter);