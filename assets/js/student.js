// ============================================================
// STUDENT.JS — Student dashboard logic
// ============================================================

const STUDENT_PROJECT_CAP = 8;

let currentUser = null;
let currentProfile = null;
let myProjects = [];
let myNotifications = [];
let myMessages = [];
let myActivity = [];
let communityProjects = [];
let profileSkills = [];
let projectSkills = [];
let editProjectSkills = [];
let editingProjectId = null;
let currentConversation = null;
let conversationRefreshTimer = null;
let creatorComposeTarget = null;

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
  await Promise.all([loadProjects(), loadCommunityProjects(), loadNotifications(), loadActivity(), loadConversations()]);
  setupMessagingComposer();
  // Set overview name reliably (not via setTimeout in HTML)
  const ovName = document.getElementById('overview-name');
  if (ovName) ovName.textContent = currentProfile.full_name || currentUser.email;
  showSection('overview');
  startConversationRefresh();
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

  const handleEl = document.getElementById('profile-handle');
  if (handleEl) handleEl.value = profile.handle || '';
  const ageEl = document.getElementById('profile-age');
  if (ageEl) ageEl.value = profile.age || '';
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.value = profile.avatar_url || '';
  const visibilityEl = document.getElementById('profile-visibility');
  if (visibilityEl) visibilityEl.value = profile.visibility || 'public';
  const githubEl = document.getElementById('profile-github');
  if (githubEl) githubEl.value = profile.github_username || '';

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

  const visibility = document.getElementById('visibility-status');
  if (visibility) {
    visibility.textContent = profile.discoverable ? 'Live' : profile.visibility === 'hidden' ? 'Hidden' : 'Private';
    visibility.title = profile.discoverable
      ? 'Discoverable in recruiter search'
      : profile.visibility === 'hidden'
        ? 'Hidden from recruiter search'
        : 'Profile is public but not discoverable yet';
  }

  const score = calculateProfileScore(profile);
  const scoreBar = document.getElementById('overview-score-bar');
  if (scoreBar) scoreBar.style.width = `${score}%`;
  updateProfilePrompt(profile, score);
}

function calculateProfileScore(profile) {
  let score = 10;
  if (profile.headline) score += 20;
  if (profile.bio) score += 20;
  if (profile.location) score += 10;
  if (profile.availability && profile.availability !== 'not set') score += 10;
  score += Math.min((profile.skills || []).length * 5, 25);
  score += profile.handle ? 5 : 0;
  score += profile.avatar_url ? 5 : 0;
  return Math.min(score, 100);
}

function updateProfilePrompt(profile, score = calculateProfileScore(profile)) {
  const prompt = document.getElementById('profile-prompt');
  if (!prompt) return;
  const strong = prompt.querySelector('.prompt-banner__text strong');
  const span = prompt.querySelector('.prompt-banner__text span');
  const actionBtn = prompt.querySelector('.btn');
  const projectCount = myProjects.filter(project => project.visible).length;
  const discoverable = Boolean(profile?.discoverable);

  if (discoverable) {
    if (strong) strong.textContent = 'You are discoverable';
    if (span) span.textContent = 'Your profile is strong enough to appear in recruiter searches. Keep your projects updated.';
    if (actionBtn) actionBtn.textContent = 'Polish profile';
    prompt.style.borderColor = 'rgba(14,122,80,.2)';
    prompt.style.background = 'linear-gradient(135deg, rgba(14,122,80,.08) 0%, rgba(14,122,80,.04) 100%)';
    return;
  }

  const missing = [];
  if (score < 70) missing.push('raise profile score to 70+');
  if ((profile?.visibility || 'public') === 'hidden') missing.push('switch visibility to public');
  if (projectCount < 1) missing.push('add at least one visible project');

  if (strong) strong.textContent = 'Complete your profile to get discovered';
  if (span) span.textContent = missing.length
    ? `Before recruiters can find you, you still need to ${missing.join(', ')}.`
    : 'Add a headline, skills, and at least one project to appear in recruiter searches.';
  if (actionBtn) actionBtn.textContent = projectCount < 1 ? 'Add project' : 'Complete →';
  prompt.style.borderColor = 'rgba(24,71,248,.2)';
  prompt.style.background = 'linear-gradient(135deg, rgba(24,71,248,.08) 0%, rgba(24,71,248,.04) 100%)';
}

async function syncDiscoverability() {
  const score = calculateProfileScore(currentProfile || {});
  const visibleProjectCount = myProjects.filter(project => project.visible).length;
  const discoverable = score >= 70 && (currentProfile?.visibility || 'public') === 'public' && visibleProjectCount > 0;

  if (currentProfile) currentProfile.discoverable = discoverable;

  if (!currentUser?.id) return;
  const { error } = await window.sb
    .from('student_profiles')
    .update({ discoverable })
    .eq('user_id', currentUser.id);

  if (error) {
    console.warn('Failed to sync discoverability', error);
  }
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
  updateProjectLimitState();
  await syncDiscoverability();
  updateOverviewCard(currentProfile || {});
}

function updateProjectLimitState() {
  const canAdd = myProjects.length < STUDENT_PROJECT_CAP;
  const note = document.getElementById('project-limit-note');
  const navBtn = document.querySelector('.nav-item[data-section="add-project"]');
  const submitBtn = document.querySelector('#add-project-form [type="submit"]');
  if (note) {
    note.textContent = canAdd
      ? `You can add up to ${STUDENT_PROJECT_CAP} projects.`
      : `You've reached the maximum of ${STUDENT_PROJECT_CAP} projects. Edit or delete an existing project to add another.`;
  }
  if (navBtn) navBtn.disabled = !canAdd;
  if (submitBtn) submitBtn.disabled = !canAdd;
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

async function loadCommunityProjects() {
  const { data, error } = await window.sb
    .from('projects')
    .select(`
      *,
      users:user_id (
        id, full_name, email,
        student_profiles (headline, location, availability, avatar_url)
      )
    `)
    .eq('visible', true)
    .eq('review_status', 'active')
    .neq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Failed to load creator community projects', error);
    return;
  }

  communityProjects = (data || []).map(project => ({
    id: project.id,
    userId: project.user_id,
    title: project.title,
    description: project.description || '',
    tech_stack: project.tech_stack || [],
    project_type: project.project_type || 'Side Project',
    image_url: project.image_url || '',
    demo_link: project.demo_link || '',
    github_link: project.github_link || '',
    created_at: project.created_at,
    creatorName: project.users?.full_name || 'Creator',
    creatorEmail: project.users?.email || '',
    creatorHeadline: project.users?.student_profiles?.[0]?.headline || '',
    creatorLocation: project.users?.student_profiles?.[0]?.location || '',
    creatorAvailability: project.users?.student_profiles?.[0]?.availability || '',
    creatorAvatar: project.users?.student_profiles?.[0]?.avatar_url || ''
  }));

  renderCommunityProjects();
}

function renderCommunityProjects() {
  const grid = document.getElementById('community-grid');
  const empty = document.getElementById('community-empty');
  if (!grid) return;

  const q = document.getElementById('community-search-input')?.value.trim().toLowerCase() || '';
  const filtered = communityProjects.filter(project => {
    if (!q) return true;
    return project.title.toLowerCase().includes(q)
      || project.creatorName.toLowerCase().includes(q)
      || project.description.toLowerCase().includes(q)
      || project.tech_stack.some(skill => skill.toLowerCase().includes(q));
  });

  if (!filtered.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = filtered.map(project => `
    <div class="student-card animate-fade-up">
      <div class="student-card__top">
        <div class="student-avatar">${getThreadInitials(project.creatorName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(project.title)}</h3>
          <p class="student-card__headline">${escHtml(project.creatorName)}</p>
          <div class="student-card__meta">
            <span class="muted">${escHtml(project.project_type)}</span>
          </div>
        </div>
      </div>
      <p class="student-card__summary">${escHtml(project.description.slice(0, 120))}${project.description.length > 120 ? '...' : ''}</p>
      <div class="project-card__skills">
        ${(project.tech_stack || []).slice(0, 4).map(skill => `<span class="skill-chip skill-chip--sm">${escHtml(skill)}</span>`).join('')}
      </div>
      <div class="student-card__footer">
        ${project.creatorLocation ? `<span class="muted">${escHtml(project.creatorLocation)}</span>` : '<span class="muted">Location not shared</span>'}
        ${project.creatorAvailability ? `<span class="role-badge role-badge--${project.creatorAvailability === 'available' ? 'success' : 'grey'}">${escHtml(project.creatorAvailability)}</span>` : ''}
      </div>
      <div class="student-card__actions">
        ${project.demo_link ? `<a class="btn btn--sm btn--outline" href="${escHtml(project.demo_link)}" target="_blank" rel="noopener">Live demo</a>` : `<button class="btn btn--sm btn--outline" disabled>No demo</button>`}
        <button class="btn btn--sm btn--primary" onclick="openCreatorComposer('${project.id}')">Discuss project</button>
      </div>
    </div>
  `).join('');
}
async function loadConversations() {
  const { data, error } = await window.sb
    .from('conversations')
    .select(`*, recruiter:recruiter_id(id, full_name, email), project:project_id(id, title), last_message:messages (id, body, created_at, sender_id, read)`)
    .eq('student_id', currentUser.id)
    .order('created_at', { ascending: false });

  const { data: creatorData, error: creatorError } = await window.sb
    .from('creator_conversations')
    .select(`
      *,
      project:project_id(id, title),
      initiator:initiator_id(id, full_name, email),
      creator_one:creator_one_id(id, full_name, email),
      creator_two:creator_two_id(id, full_name, email),
      last_message:creator_messages(id, body, created_at, sender_id, read)
    `)
    .or(`creator_one_id.eq.${currentUser.id},creator_two_id.eq.${currentUser.id}`)
    .order('created_at', { ascending: false });

  if (error) { console.warn('Failed to load recruiter conversations', error); }
  if (creatorError) { console.warn('Failed to load creator conversations', creatorError); }

  const recruiterMessages = (data || []).map(conv => ({
    ...conv,
    threadType: 'recruiter',
    partnerName: conv.recruiter?.full_name || conv.recruiter?.email || 'Recruiter',
    partnerRoleLabel: 'Recruiter thread',
    last_message: Array.isArray(conv.last_message)
      ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      : conv.last_message
  }));

  const creatorMessages = (creatorData || []).map(conv => {
    const partner = conv.creator_one_id === currentUser.id ? conv.creator_two : conv.creator_one;
    return {
      ...conv,
      threadType: 'creator',
      partnerName: partner?.full_name || partner?.email || 'Creator',
      partnerRoleLabel: 'Creator discussion',
      last_message: Array.isArray(conv.last_message)
        ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : conv.last_message
    };
  });

  myMessages = [...recruiterMessages, ...creatorMessages].sort((a, b) => {
    const aTime = a.last_message?.created_at || a.created_at;
    const bTime = b.last_message?.created_at || b.created_at;
    return new Date(bTime) - new Date(aTime);
  });

  renderConversations();
  if (currentConversation && myMessages.some(conv => conv.id === currentConversation)) {
    await loadConversationMessages(currentConversation);
  } else if (!currentConversation && myMessages[0]) {
    await openConversation(myMessages[0].id);
  } else if (!myMessages.length) {
    renderEmptyConversation();
  }
}

function renderConversations() {
  const list = document.getElementById('messages-threads');
  const empty = document.getElementById('messages-empty');
  const count = document.getElementById('message-count');
  if (count) count.textContent = String(myMessages.length || 0);
  if (!list) return;

  if (!myMessages.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    renderEmptyConversation();
    return;
  }
  if (empty) empty.classList.add('hidden');
  list.innerHTML = myMessages.map(c => {
    const last = c.last_message || {};
    const isCreator = c.threadType === 'creator';
    const status = getThreadStatus(c);
    return `
      <button class="thread-card ${c.id === currentConversation ? 'thread-card--active' : ''}" onclick="openConversation('${c.id}')">
        <div class="thread-card__avatar">${getThreadInitials(c.partnerName)}</div>
        <div class="thread-card__body">
          <div class="thread-card__top">
            <strong>${escHtml(c.partnerName)}</strong>
            <span class="thread-card__time">${fmtTime(last.created_at)}</span>
          </div>
          <div class="thread-card__project ${isCreator ? 'thread-card__project--creator' : ''}">${escHtml(c.project?.title || 'Direct conversation')}</div>
          <div class="thread-card__role">${escHtml(c.partnerRoleLabel)} · ${escHtml(status)}</div>
          <div class="thread-card__preview">${escHtml(last.body || 'No messages yet')}</div>
        </div>
      </button>`;
  }).join('');

  const activeExists = currentConversation && myMessages.some(c => c.id === currentConversation);
  if (!activeExists) currentConversation = null;
}

async function openConversation(convId) {
  currentConversation = convId;
  renderConversations();
  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return;
  document.getElementById('chat-title').textContent = conv.partnerName;
  document.getElementById('chat-meta').textContent = conv.project?.title || 'Direct conversation';
  const badge = document.getElementById('chat-trust-badge');
  if (badge) {
    badge.textContent = conv.threadType === 'creator' ? `Creator discussion · ${getThreadStatus(conv)}` : `Recruiter thread · ${getThreadStatus(conv)}`;
    badge.className = 'thread-status-badge thread-status-badge--ok';
  }
  await loadConversationMessages(convId);
  document.getElementById('chat-send-btn').onclick = sendStudentMessage;
}

async function loadConversationMessages(convId) {
  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return;
  const table = conv.threadType === 'creator' ? 'creator_messages' : 'messages';
  const fk = conv.threadType === 'creator' ? 'creator_conversation_id' : 'conversation_id';
  const { data, error } = await window.sb.from(table).select('*').eq(fk, convId).order('created_at', { ascending: true });
  if (error) { showToast('Failed to load thread', 'error'); return; }
  const unreadIncoming = (data || []).filter(m => m.sender_id !== currentUser.id && !m.read).map(m => m.id);
  if (unreadIncoming.length) {
    const { error: readError } = await window.sb.from(table).update({ read: true }).in('id', unreadIncoming);
    if (readError) console.warn('Failed to mark thread as read', readError);
    (data || []).forEach(m => {
      if (unreadIncoming.includes(m.id)) m.read = true;
    });
  }
  const pane = document.getElementById('chat-messages');
  if (!data?.length) {
    pane.innerHTML = '<div class="chat-empty">No messages in this thread yet.</div>';
    return;
  }
  pane.innerHTML = (data || []).map(m => `
    <div class="chat-row ${m.sender_id === currentUser.id ? 'chat-row--mine' : ''}">
      <div class="chat-bubble ${m.sender_id === currentUser.id ? 'chat-bubble--mine' : ''}">
        <div class="chat-bubble__text">${escHtml(m.body)}</div>
        <div class="chat-bubble__meta">${fmtTime(m.created_at)}</div>
      </div>
    </div>
  `).join('');
  pane.scrollTop = pane.scrollHeight;
  await loadConversations();
}

async function sendStudentMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || !currentConversation) return;
  const conv = myMessages.find(c => c.id === currentConversation);
  if (!conv) return;
  const body = input.value.trim().slice(0,1000);
  const sendBtn = document.getElementById('chat-send-btn');
  setBtnLoading(sendBtn, true, 'Sending...');
  const table = conv.threadType === 'creator' ? 'creator_messages' : 'messages';
  const payload = conv.threadType === 'creator'
    ? { creator_conversation_id: currentConversation, sender_id: currentUser.id, body }
    : { conversation_id: currentConversation, sender_id: currentUser.id, body };
  const { error } = await window.sb.from(table).insert(payload);
  setBtnLoading(sendBtn, false);
  if (error) { showToast('Failed to send', 'error'); return; }
  input.value = '';
  await loadConversations();
}

function setupMessagingComposer() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.onclick = sendStudentMessage;
  const creatorComposeBtn = document.getElementById('creator-compose-send-btn');
  const creatorComposeInput = document.getElementById('creator-compose-input');
  if (creatorComposeBtn) creatorComposeBtn.onclick = sendCreatorComposeMessage;
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendStudentMessage();
    }
  });
  creatorComposeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCreatorComposeMessage();
    }
  });
}

function renderEmptyConversation() {
  const title = document.getElementById('chat-title');
  const meta = document.getElementById('chat-meta');
  const pane = document.getElementById('chat-messages');
  const badge = document.getElementById('chat-trust-badge');
  if (title) title.textContent = 'Select a thread';
  if (meta) meta.textContent = 'Recruiter outreach and creator discussions stay private inside Solvoriz.';
  if (badge) {
    badge.textContent = 'Protected inbox';
    badge.className = 'thread-status-badge thread-status-badge--ok';
  }
  if (pane) {
    pane.innerHTML = `
      <div class="chat-empty">
        <strong>Your inbox is ready.</strong>
        <span>When a recruiter or another creator reaches out, the full conversation will appear here.</span>
      </div>
    `;
  }
}

function getThreadStatus(conversation) {
  const last = conversation?.last_message;
  if (!last) return 'No activity';
  if (last.sender_id === currentUser.id) return last.read ? 'Seen' : 'Sent';
  return 'Replied';
}

function openCreatorComposer(projectId) {
  const project = communityProjects.find(item => item.id === projectId);
  if (!project) return;
  creatorComposeTarget = project;
  const modal = document.getElementById('creator-compose-modal');
  const avatar = document.getElementById('creator-compose-avatar');
  const name = document.getElementById('creator-compose-name');
  const meta = document.getElementById('creator-compose-meta');
  const input = document.getElementById('creator-compose-input');
  if (avatar) avatar.textContent = getThreadInitials(project.creatorName);
  if (name) name.textContent = project.creatorName;
  if (meta) meta.textContent = `${project.title} · ${project.project_type}`;
  if (input) input.value = '';
  modal?.classList.remove('hidden');
  input?.focus();
}

function closeCreatorComposer() {
  document.getElementById('creator-compose-modal')?.classList.add('hidden');
  creatorComposeTarget = null;
}

async function sendCreatorComposeMessage() {
  if (!creatorComposeTarget) return;
  const input = document.getElementById('creator-compose-input');
  const body = input?.value.trim().slice(0, 1000) || '';
  if (!body) return;

  const sendBtn = document.getElementById('creator-compose-send-btn');
  setBtnLoading(sendBtn, true, 'Sending...');

  const conversation = await ensureCreatorConversation(creatorComposeTarget.userId, creatorComposeTarget.id);
  if (!conversation) {
    setBtnLoading(sendBtn, false);
    return;
  }

  const { error } = await window.sb.from('creator_messages').insert({
    creator_conversation_id: conversation.id,
    sender_id: currentUser.id,
    body
  });

  setBtnLoading(sendBtn, false);
  if (error) {
    showToast(`Failed to send: ${error.message}`, 'error');
    return;
  }

  await createNotification(creatorComposeTarget.userId, 'creator_discussion', {
    creator_id: currentUser.id,
    creator_name: currentProfile.full_name || currentUser.email,
    message: body,
    project_id: creatorComposeTarget.id
  });

  if (input) input.value = '';
  closeCreatorComposer();
  showToast('Creator discussion started.', 'success');
  await loadConversations();
  await openConversation(conversation.id);
  showSection('messages');
}

async function ensureCreatorConversation(otherCreatorId, projectId) {
  const creatorOneId = [currentUser.id, otherCreatorId].sort()[0];
  const creatorTwoId = [currentUser.id, otherCreatorId].sort()[1];

  const { data: existing, error: existingError } = await window.sb
    .from('creator_conversations')
    .select('*')
    .eq('creator_one_id', creatorOneId)
    .eq('creator_two_id', creatorTwoId)
    .eq('project_id', projectId)
    .limit(1);

  if (existingError) {
    showToast(`Failed to open creator discussion: ${existingError.message}`, 'error');
    return null;
  }
  if (existing?.length) return existing[0];

  const { data: created, error: createError } = await window.sb
    .from('creator_conversations')
    .insert({
      creator_one_id: creatorOneId,
      creator_two_id: creatorTwoId,
      initiator_id: currentUser.id,
      project_id: projectId
    })
    .select()
    .single();

  if (createError) {
    showToast(`Failed to start creator discussion: ${createError.message}`, 'error');
    return null;
  }

  return created;
}

function getThreadInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function startConversationRefresh() {
  stopConversationRefresh();
  conversationRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadConversations();
      loadNotifications();
    }
  }, 15000);
}

function stopConversationRefresh() {
  if (conversationRefreshTimer) {
    window.clearInterval(conversationRefreshTimer);
    conversationRefreshTimer = null;
  }
}

async function loadActivity() {
  const { data, error } = await window.sb
    .from('activity_log')
    .select(`*, 
      actor:actor_id (id, full_name, email, student_profiles(headline, location))
    `)
    .eq('target_user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.warn('Failed to load activity', error); return; }
  myActivity = data || [];
  renderActivity();
}

function renderActivity() {
  const list = document.getElementById('activity-list');
  const empty = document.getElementById('activity-empty');
  if (!list) return;
  
  if (!myActivity.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = myActivity.map(act => {
    let icon, title, desc;
    const actor = act.actor?.[0];
    const actorName = actor?.full_name || actor?.email || 'Someone';
    const actorHeadline = actor?.student_profiles?.[0]?.headline || '';

    if (act.action_type === 'profile_view') {
      icon = '👀';
      title = 'Profile viewed';
      desc = `${actorName} viewed your profile`;
    } else if (act.action_type === 'project_view') {
      icon = '🔍';
      title = 'Project viewed';
      desc = `${actorName} viewed your project`;
    } else if (act.action_type === 'shortlist') {
      icon = '⭐';
      title = 'Added to shortlist';
      desc = `${actorName} shortlisted your project`;
    } else if (act.action_type === 'contact_sent') {
      icon = '💬';
      title = 'Message received';
      desc = `${actorName} sent you a message`;
    } else {
      icon = '📌';
      title = 'Activity';
      desc = `${act.action_type}`;
    }

    return `
      <div class="card animate-fade-up">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="font-size:1.5rem;min-width:36px;text-align:center">${icon}</div>
          <div style="flex:1">
            <div><strong>${escHtml(title)}</strong></div>
            <div class="muted" style="margin-top:4px">${escHtml(desc)}</div>
            ${actorHeadline ? `<div class="muted" style="margin-top:4px;font-size:.9rem">${escHtml(actorHeadline)}</div>` : ''}
            <div class="muted" style="margin-top:8px;font-size:.85rem">${fmtDate(act.created_at)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
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
    if (note.type === 'contact_request') {
      return `
        <div class="card notification-card animate-fade-up">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div>
              <strong>💬 New message from recruiter</strong>
              <div class="muted" style="margin-top:6px;max-width:400px">"${escHtml(note.payload?.recruiter_name || 'A recruiter')}"</div>
              <div style="margin-top:8px;padding:10px;background:var(--surface-2);border-radius:6px;font-size:.95rem">
                ${escHtml(note.payload?.message || 'No message text')}
              </div>
            </div>
            <span class="role-badge role-badge--grey">${fmtDate(note.created_at)}</span>
          </div>
        </div>
      `;
    }
    const title = note.type === 'project_feature'
      ? 'Project updated'
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
      ${p.image_url ? `<div class="project-card__image" style="background-image:url('${escHtml(p.image_url)}')"></div>` : ''}
      <div class="project-card__header">
        <div>
          <h3 class="project-card__title">${escHtml(p.title)}</h3>
          <div class="project-card__meta">${escHtml(p.project_type || 'Side Project')}</div>
        </div>
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
        <span>${p.visible ? 'Visible' : 'Hidden'}</span>
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

  if (section === 'activity') loadActivity();
  if (section === 'community') renderCommunityProjects();
  if (section === 'messages') {
    renderConversations();
    if (!currentConversation) renderEmptyConversation();
  }
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
    max: 10
  });

  addProjectSkillsInput = initSkillInput({
    wrapId: 'add-proj-skills-wrap',
    inputId: 'add-proj-skill-input',
    suggestId: 'add-proj-skill-suggest',
    arr: projectSkills,
    max: 5
  });

  editProjectSkillsInput = initSkillInput({
    wrapId: 'edit-proj-skills-wrap',
    inputId: 'edit-proj-skill-input',
    suggestId: 'edit-proj-skill-suggest',
    arr: editProjectSkills,
    max: 10
  });

  document.getElementById('community-search-input')?.addEventListener('input', renderCommunityProjects);
}

// ── SAVE PROFILE ─────────────────────────────────────────
async function saveProfile(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Saving...');

  const payload = {
    user_id: currentUser.id,
    handle: document.getElementById('profile-handle').value.trim() || null,
    age: parseInt(document.getElementById('profile-age').value, 10) || null,
    avatar_url: document.getElementById('profile-avatar').value.trim() || null,
    github_username: document.getElementById('profile-github').value.trim() || null,
    headline: document.getElementById('profile-headline').value.trim(),
    bio: document.getElementById('profile-bio').value.trim(),
    location: document.getElementById('profile-location').value.trim(),
    visibility: document.getElementById('profile-visibility').value,
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
  await syncDiscoverability();
  showSection('overview');
}

// ── ADD PROJECT ──────────────────────────────────────────
async function addProject(e) {
  e.preventDefault();
  if (myProjects.length >= STUDENT_PROJECT_CAP) {
    showToast(`You can only keep ${STUDENT_PROJECT_CAP} projects at a time.`, 'warn');
    return;
  }
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Adding...');

  const payload = {
    user_id: currentUser.id,
    title: document.getElementById('proj-title').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    tech_stack: [...projectSkills],
    project_type: document.getElementById('proj-type').value,
    image_url: document.getElementById('proj-image').value.trim() || null,
    visible: document.getElementById('proj-visible').value === 'true',
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
  await loadStudentProfile();
  showSection('projects');
}

// ── EDIT PROJECT ─────────────────────────────────────────
function openEditProject(id) {
  const project = myProjects.find(p => p.id === id);
  if (!project) return;
  editingProjectId = id;

  document.getElementById('edit-proj-title').value = project.title || '';
  document.getElementById('edit-proj-desc').value = project.description || '';
  document.getElementById('edit-proj-type').value = project.project_type || 'Side Project';
  document.getElementById('edit-proj-image').value = project.image_url || '';
  document.getElementById('edit-proj-visible').value = project.visible ? 'true' : 'false';
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
    project_type: document.getElementById('edit-proj-type').value,
    image_url: document.getElementById('edit-proj-image').value.trim() || null,
    visible: document.getElementById('edit-proj-visible').value === 'true',
    demo_link: document.getElementById('edit-proj-demo').value.trim() || null,
    github_link: document.getElementById('edit-proj-github').value.trim() || null
  };

  const { error } = await window.sb.from('projects').update(payload).eq('id', editingProjectId);
  setBtnLoading(btn, false);

  if (error) { showToast('Failed to update: ' + error.message, 'error'); return; }
  showToast('Project updated!', 'success');
  closeEditModal();
  await loadProjects();
  await loadStudentProfile();
}

// ── DELETE PROJECT ───────────────────────────────────────
async function deleteProject(id) {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  const { error } = await window.sb.from('projects').delete().eq('id', id);
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }
  showToast('Project deleted', 'warn');
  await loadProjects();
  await loadStudentProfile();
}

// ── PUBLIC PROFILE LINK ─────────────────────────────────
function openPublicProfile() {
  const handle = currentProfile?.handle;
  if (handle) {
    window.open(`/profile.html?handle=${encodeURIComponent(handle)}`, '_blank');
    return;
  }
  showToast('Set a public handle on your profile to preview it.', 'info');
}

// ── LOGOUT ───────────────────────────────────────────────
async function logout() {
  stopConversationRefresh();
  await Auth.signOut();
  window.location.href = '/index.html';
}

// ── BOOT ─────────────────────────────────────────────────
window.openCreatorComposer = openCreatorComposer;
window.closeCreatorComposer = closeCreatorComposer;

document.addEventListener('DOMContentLoaded', initStudent);
window.addEventListener('beforeunload', stopConversationRefresh);
