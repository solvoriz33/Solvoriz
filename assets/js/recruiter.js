// ============================================================
// RECRUITER.JS - Recruiter dashboard logic
// ============================================================

let currentUser = null;
let currentProfile = null;
let allProjects = [];
let myNotifications = [];
let myMessages = [];
let shortlistProjectIds = [];
let filterSkills = [];
let filterSkillsInput = null;
let currentConversation = null;
let chatRefreshTimer = null;
let composeTarget = null;
let recruiterRealtimeChannel = null;
let recruiterThreadChannel = null;

const PROJECT_PAGE_SIZE = 24;
const CONVERSATION_PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 50;

function normalizeProfileJoin(profileJoin) {
  if (Array.isArray(profileJoin)) return profileJoin[0] || null;
  return profileJoin || null;
}

function calculateDiscoverabilityScore(profile = {}) {
  let score = 10;
  if (profile.headline) score += 20;
  if (profile.bio) score += 20;
  if (profile.location) score += 10;
  if (profile.availability && profile.availability !== 'not set') score += 10;
  score += Math.min((profile.skills || []).length * 5, 25);
  score += profile.avatar_url ? 5 : 0;
  return Math.min(score, 100);
}

function isSearchReadyProfile(profile = {}) {
  if (!profile || profile.visibility === 'hidden' || profile.review_status === 'flagged') return false;
  if (profile.discoverable) return true;
  return calculateDiscoverabilityScore(profile) >= 60;
}

function getUnreadCountFromFeed(messageFeed = []) {
  return messageFeed.filter(message => message.sender_id !== currentUser?.id && !message.read).length;
}

function isValidMeetLink(link) {
  return /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test((link || '').trim());
}

async function initRecruiter() {
  const result = await requireAuth('recruiter');
  if (!result) return;

  currentUser = result.session.user;
  currentProfile = result.profile;

  document.getElementById('user-name').textContent = currentProfile.full_name || currentUser.email;
  document.getElementById('user-email').textContent = currentUser.email;
  document.getElementById('user-avatar').textContent = getInitials(currentProfile.full_name || currentUser.email);

  if (!currentProfile.verified_recruiter) {
    showToast('Your recruiter account is pending verification. Messaging is locked until you are verified.', 'warn');
  }

  await ensureRecruiterPolicyAccepted();

  filterSkillsInput = initSkillInput({
    wrapId: 'filter-skills-wrap',
    inputId: 'filter-skill-input',
    suggestId: 'filter-skill-suggest',
    arr: filterSkills,
    max: 10,
    onChange: () => applyFilters()
  });

  await Promise.all([loadAllProjects(), loadShortlist(), loadNotifications(), loadConversations()]);
  setupSearch();
  setupMessagingComposer();
  startRealtimeSync();
  updateDashboardStats();
  showSection('browse');
  startChatRefresh();
}

async function ensureRecruiterPolicyAccepted() {
  const { data, error } = await window.sb
    .from('recruiter_onboarding_acceptances')
    .select('id')
    .eq('recruiter_id', currentUser.id)
    .limit(1);

  if (error) {
    console.warn('Unable to verify recruiter guidelines acceptance', error);
    return;
  }

  if (!data || !data.length) {
    showRecruiterPolicyModal();
    await new Promise(resolve => { window.__recruiterPolicyResolve = resolve; });
  }
}

function showRecruiterPolicyModal() {
  document.getElementById('recruiter-policy-modal')?.classList.remove('hidden');
  const btn = document.getElementById('accept-recruiter-policy-btn');
  if (btn) btn.onclick = acceptRecruiterPolicy;
}

function hideRecruiterPolicyModal() {
  document.getElementById('recruiter-policy-modal')?.classList.add('hidden');
}

async function acceptRecruiterPolicy() {
  const { error } = await window.sb.from('recruiter_onboarding_acceptances').insert({
    recruiter_id: currentUser.id,
    ip_address: window.location.hostname || ''
  });
  if (error) {
    showToast('Unable to save acceptance: ' + error.message, 'error');
    return;
  }
  hideRecruiterPolicyModal();
  if (window.__recruiterPolicyResolve) {
    window.__recruiterPolicyResolve();
    window.__recruiterPolicyResolve = null;
  }
  showToast('Thanks for accepting the recruiter guidelines.', 'success');
}

async function loadAllProjects() {
  const loadingEl = document.getElementById('students-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');

  const { data, error } = await window.sb.rpc('list_discoverable_projects', {
    p_limit: PROJECT_PAGE_SIZE,
    p_offset: 0
  });

  if (loadingEl) loadingEl.classList.add('hidden');
  if (error) {
    showToast('Failed to load projects', 'error');
    return;
  }

  allProjects = (data || []).map(project => ({
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
    builderName: project.builder_name || 'Anonymous',
    builderEmail: '',
    builderHeadline: project.builder_headline || '',
    builderLocation: project.builder_location || '',
    builderAge: project.builder_age || null,
    builderAvailability: project.builder_availability || '',
    builderSkills: project.builder_skills || [],
    builderAvatar: project.builder_avatar || '',
    builderVisibility: 'public',
    builderDiscoverable: Boolean(project.builder_discoverable),
    builderFeatured: Boolean(project.builder_featured),
    builderReviewStatus: 'approved',
    builderSearchReady: true,
    builderScore: calculateDiscoverabilityScore({
      headline: project.builder_headline,
      location: project.builder_location,
      availability: project.builder_availability,
      skills: project.builder_skills,
      avatar_url: project.builder_avatar
    })
  }));

  document.getElementById('student-count').textContent = allProjects.length;
  renderProjects(allProjects);
}

async function loadShortlist() {
  const { data, error } = await window.sb
    .from('shortlists')
    .select('project_id')
    .eq('recruiter_id', currentUser.id);

  if (error) {
    showToast('Failed to load shortlist', 'error');
    return;
  }

  shortlistProjectIds = (data || []).map(s => s.project_id);
  renderShortlist();
  updateShortlistCount();
}

function renderProjects(projects) {
  const grid = document.getElementById('students-grid');
  const empty = document.getElementById('students-empty');
  if (!grid) return;

  if (!projects.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = projects.map(project => {
    const isShortlisted = shortlistProjectIds.includes(project.id);
    return `
      <div class="student-card animate-fade-up">
        <div class="student-card__top">
          <div class="student-avatar">${getInitials(project.builderName)}</div>
          <div class="student-card__info">
            <h3 class="student-card__name">${escHtml(project.title)}</h3>
            <p class="student-card__headline">${escHtml(project.builderName)}</p>
            <div class="student-card__meta">
              <span class="muted">${escHtml(project.project_type)}</span>
              ${project.builderFeatured ? '<span class="role-badge role-badge--recruiter">Featured</span>' : ''}
              ${project.builderDiscoverable ? '<span class="role-badge role-badge--success">Search ready</span>' : '<span class="role-badge role-badge--grey">Profile polishing</span>'}
            </div>
          </div>
          <button
            class="shortlist-btn ${isShortlisted ? 'shortlisted' : ''}"
            onclick="event.stopPropagation();toggleShortlist('${project.id}')"
            title="${isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}"
          >★</button>
        </div>

        <p class="student-card__summary">${escHtml(project.description.slice(0, 120))}${project.description.length > 120 ? '...' : ''}</p>

        <div class="project-card__skills">
          ${(project.tech_stack || []).slice(0, 4).map(skill => `<span class="skill-chip skill-chip--sm">${escHtml(skill)}</span>`).join('')}
        </div>

        <div class="student-card__footer">
          ${project.builderLocation ? `<span class="muted">${escHtml(project.builderLocation)}</span>` : '<span class="muted">Location not shared</span>'}
          ${project.builderAvailability ? `<span class="role-badge role-badge--${project.builderAvailability === 'available' ? 'success' : 'grey'}">${escHtml(project.builderAvailability)}</span>` : ''}
        </div>

        <div class="student-card__actions">
          <button class="btn btn--sm btn--primary" onclick="event.stopPropagation();openProjectDetail('${project.id}')">View project</button>
          <button class="btn btn--sm btn--outline" onclick="event.stopPropagation();openMessageComposer('${project.id}')">Message creator</button>
        </div>
      </div>
    `;
  }).join('');
}

function openProjectDetail(projectId) {
  const project = allProjects.find(p => p.id === projectId);
  if (!project) return;

  logActivity('project_view', 'project', projectId, project.userId);

  const modal = document.getElementById('student-modal');
  const content = document.getElementById('student-modal-content');
  if (!modal || !content) return;

  const isShortlisted = shortlistProjectIds.includes(project.id);
  const trustLabel = currentProfile.verified_recruiter ? 'Verified recruiter account' : 'Messaging locked until verification';

  content.innerHTML = `
    <div class="project-detail">
      <div class="project-detail__hero">
        <div>
          <div class="thread-status-badge ${currentProfile.verified_recruiter ? 'thread-status-badge--ok' : ''}">${escHtml(trustLabel)}</div>
          <h2>${escHtml(project.title)}</h2>
          <p class="muted">${escHtml(project.builderName)} · ${escHtml(project.project_type)}</p>
        </div>
        <button
          class="shortlist-btn ${isShortlisted ? 'shortlisted' : ''}"
          onclick="toggleShortlist('${project.id}');renderProjectDetail('${project.id}')"
          title="${isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}"
        >★</button>
      </div>

      ${project.image_url ? `<div class="project-detail__image" style="background-image:url('${escHtml(project.image_url)}')"></div>` : ''}

      <div class="project-detail__section">
        <h3>About this project</h3>
        <p>${escHtml(project.description || 'No description added yet.')}</p>
      </div>

      <div class="project-detail__section">
        <h3>Tech stack</h3>
        <div class="skill-chips-row">
          ${(project.tech_stack || []).map(skill => `<span class="skill-chip">${escHtml(skill)}</span>`).join('')}
        </div>
      </div>

      <div class="trust-card">
        <div class="trust-card__header">
          <div class="student-avatar">${getInitials(project.builderName)}</div>
          <div>
            <strong>${escHtml(project.builderName)}</strong>
            <div class="muted">${escHtml(project.builderHeadline || 'Creator profile')}</div>
          </div>
        </div>
        <div class="trust-card__meta">
          ${project.builderLocation ? `<span>${escHtml(project.builderLocation)}</span>` : ''}
          ${project.builderAvailability ? `<span>${escHtml(project.builderAvailability)}</span>` : ''}
          ${project.builderAge ? `<span>Age ${project.builderAge}</span>` : ''}
        </div>
      </div>

      <div class="project-card__links">
        ${project.demo_link ? `<a class="project-link" href="${escHtml(project.demo_link)}" target="_blank" rel="noopener">Live demo</a>` : ''}
        ${project.github_link ? `<a class="project-link" href="${escHtml(project.github_link)}" target="_blank" rel="noopener">GitHub</a>` : ''}
      </div>

      <div class="student-card__actions">
        <button class="btn btn--primary" onclick="openMessageComposer('${project.id}')">Start conversation</button>
        <button class="btn btn--outline" onclick="closeStudentModal()">Close</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function renderProjectDetail(projectId) {
  openProjectDetail(projectId);
}

function getInitials(name) {
  return (name || '?').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
}

function closeStudentModal() {
  document.getElementById('student-modal')?.classList.add('hidden');
}

function setupMessagingComposer() {
  const input = document.getElementById('chat-input');
  const composeInput = document.getElementById('compose-message-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const composeBtn = document.getElementById('compose-send-btn');

  if (sendBtn) sendBtn.onclick = sendRecruiterMessage;
  if (composeBtn) composeBtn.onclick = sendComposerMessage;

  [input, composeInput].forEach(field => {
    if (!field) return;
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (field.id === 'chat-input') {
          sendRecruiterMessage();
        } else {
          sendComposerMessage();
        }
      }
    });
  });
}

function openMessageComposer(projectId) {
  const project = allProjects.find(p => p.id === projectId);
  if (!project) return;

  composeTarget = project;
  closeStudentModal();

  const modal = document.getElementById('message-compose-modal');
  const name = document.getElementById('compose-recipient-name');
  const meta = document.getElementById('compose-recipient-meta');
  const body = document.getElementById('compose-message-input');
  const trust = document.getElementById('compose-trust-copy');
  const avatar = document.getElementById('compose-recipient-avatar');

  if (name) name.textContent = project.builderName;
  if (meta) meta.textContent = `${project.title} · ${project.project_type}`;
  if (avatar) avatar.textContent = getInitials(project.builderName);
  if (trust) {
    trust.textContent = currentProfile.verified_recruiter
      ? 'Your message will open a direct thread with this creator.'
      : 'Your recruiter account must be verified before you can message creators.';
  }
  if (body) body.value = '';
  modal?.classList.remove('hidden');
  body?.focus();
}

function closeMessageComposer() {
  document.getElementById('message-compose-modal')?.classList.add('hidden');
  composeTarget = null;
}

async function sendComposerMessage() {
  if (!composeTarget) return;
  await sendMessageToProject(composeTarget, document.getElementById('compose-message-input'));
}

async function sendMessageToProject(project, inputEl) {
  if (!currentProfile.verified_recruiter) {
    showToast('You must be a verified recruiter to send messages.', 'error');
    return;
  }

  const raw = inputEl?.value || '';
  const body = raw.trim().slice(0, 1000);
  if (!body) return;

  const sendBtn = document.getElementById(inputEl?.id === 'compose-message-input' ? 'compose-send-btn' : 'chat-send-btn');
  setBtnLoading(sendBtn, true, 'Sending...');

  const conversation = await ensureConversation(project.userId, project.id);
  if (!conversation) {
    setBtnLoading(sendBtn, false);
    return;
  }

  const { error } = await window.sb.from('messages').insert({
    conversation_id: conversation.id,
    sender_id: currentUser.id,
    body
  });

  setBtnLoading(sendBtn, false);
  if (error) {
    showToast(`Failed to send message: ${error.message}`, 'error');
    return;
  }

  await createNotification(project.userId, 'contact_request', {
    recruiter_id: currentUser.id,
    recruiter_name: currentProfile.full_name || currentUser.email,
    message: body,
    project_id: project.id
  });

  logActivity('contact_sent', 'project', project.id, project.userId);

  if (inputEl) inputEl.value = '';
  closeMessageComposer();
  showToast('Conversation started.', 'success');
  await loadConversations(true);
  await openConversation(conversation.id);
  showSection('messages');
}

async function ensureConversation(studentId, projectId) {
  if (!projectId) {
    showToast('Missing project id. Messaging requires a project.', 'error');
    return null;
  }

  const { data: existing, error: existingError } = await window.sb
    .from('conversations')
    .select('*')
    .eq('recruiter_id', currentUser.id)
    .eq('student_id', studentId)
    .eq('project_id', projectId)
    .limit(1);

  if (existingError) {
    showToast(`Failed to open conversation: ${existingError.message}`, 'error');
    return null;
  }

  if (existing?.length) return existing[0];

  const { data: created, error: createError } = await window.sb
    .from('conversations')
    .insert({
      recruiter_id: currentUser.id,
      student_id: studentId,
      project_id: projectId
    })
    .select()
    .single();

  if (createError) {
    showToast(`Failed to start conversation: ${createError.message}`, 'error');
    return null;
  }

  return created;
}

async function loadConversations(preserveSelection = true) {
  const { data, error } = await window.sb
    .from('conversations')
    .select(`
      *,
      student:student_id(id, full_name, email),
      project:project_id(id, title),
      last_message:messages(id, body, created_at, sender_id, read)
    `)
    .eq('recruiter_id', currentUser.id)
    .order('last_message_at', { ascending: false })
    .range(0, CONVERSATION_PAGE_SIZE - 1);

  if (error) {
    showToast('Failed to load messages', 'error');
    return;
  }

  myMessages = (data || []).map(conv => ({
    ...conv,
    message_feed: Array.isArray(conv.last_message)
      ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      : conv.last_message ? [conv.last_message] : [],
    last_message: Array.isArray(conv.last_message)
      ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      : conv.last_message,
    unread_count: getUnreadCountFromFeed(Array.isArray(conv.last_message) ? conv.last_message : conv.last_message ? [conv.last_message] : [])
  }));

  renderConversations();
  updateDashboardStats();

  if (preserveSelection && currentConversation && myMessages.some(conv => conv.id === currentConversation)) {
    await loadConversationMessages(currentConversation);
  } else if (!currentConversation && myMessages[0]) {
    await openConversation(myMessages[0].id);
  } else if (!preserveSelection && myMessages[0]) {
    await openConversation(myMessages[0].id);
  } else if (!myMessages.length) {
    renderEmptyChatState();
  }
}

function renderConversations() {
  const threads = document.getElementById('messages-threads');
  const empty = document.getElementById('messages-empty');
  const navCount = document.getElementById('message-count');
  const dashboardCount = document.getElementById('dashboard-message-count');
  const unreadTotal = myMessages.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);

  if (navCount) navCount.textContent = String(unreadTotal || myMessages.length || 0);
  if (dashboardCount) dashboardCount.textContent = String(unreadTotal || myMessages.length || 0);
  if (!threads) return;

  if (!myMessages.length) {
    threads.innerHTML = '';
    empty?.classList.remove('hidden');
    renderEmptyChatState();
    return;
  }

  empty?.classList.add('hidden');
  threads.innerHTML = myMessages.map(conv => {
    const last = conv.last_message || {};
    const active = conv.id === currentConversation;
    const status = getThreadStatus(conv);
    return `
      <button class="thread-card ${active ? 'thread-card--active' : ''}" onclick="openConversation('${conv.id}')">
        <div class="thread-card__avatar">${getInitials(conv.student?.full_name || conv.student?.email || 'Builder')}</div>
        <div class="thread-card__body">
          <div class="thread-card__top">
            <strong>${escHtml(conv.student?.full_name || conv.student?.email || 'Builder')}</strong>
            <div style="display:flex;align-items:center;gap:8px">
              ${conv.unread_count ? `<span class="nav-count">${conv.unread_count}</span>` : ''}
              <span class="thread-card__time">${fmtTime(last.created_at)}</span>
            </div>
          </div>
          <div class="thread-card__project">${escHtml(conv.project?.title || 'Direct conversation')}</div>
          <div class="thread-card__role">${escHtml(status)}</div>
          <div class="thread-card__preview">${escHtml(last.body || 'No messages yet')}</div>
        </div>
      </button>
    `;
  }).join('');
}

async function openConversation(convId) {
  currentConversation = convId;
  renderConversations();

  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return;

  document.getElementById('chat-title').textContent = conv.student?.full_name || conv.student?.email || 'Builder';
  document.getElementById('chat-meta').textContent = conv.project?.title || 'Direct conversation';
  document.getElementById('chat-trust-badge').textContent = `${currentProfile.verified_recruiter ? 'Verified recruiter' : 'Verification pending'} · ${getThreadStatus(conv)}`;
  document.getElementById('chat-trust-badge').className = `thread-status-badge ${currentProfile.verified_recruiter ? 'thread-status-badge--ok' : ''}`;
  renderChatActions(conv);
  // render interview UI (if any)
  renderRecruiterInterviewUI(conv);
  subscribeToRecruiterThread(convId);
  await loadConversationMessages(convId);
}

function renderChatActions(conv) {
  const container = document.getElementById('chat-actions-top');
  if (!container) return;
  if (!conv) {
    container.innerHTML = '';
    return;
  }

  const partnerId = conv.student?.id;
  container.innerHTML = `
    <button class="btn btn--outline btn--sm" onclick="reportConversation('${conv.id}','${partnerId}')">Report user</button>
    <button class="btn btn--danger btn--sm" onclick="blockConversationPartner('${partnerId}')">Block user</button>
    <span id="interview-ui-wrap"></span>
  `;
}

async function loadInterviewForRecruiter(convId) {
  if (!convId) return null;
  const { data, error } = await window.sb.from('interviews').select('*').eq('conversation_id', convId).limit(1).maybeSingle();
  if (error) {
    console.warn('Failed to load interview', error);
    return null;
  }
  return data || null;
}

async function renderRecruiterInterviewUI(conv) {
  const wrap = document.getElementById('interview-ui-wrap');
  if (!wrap) return;
  const interview = await loadInterviewForRecruiter(conv.id);
  if (!interview) {
    wrap.innerHTML = `<button class="btn btn--primary btn--sm" onclick="requestInterview('${conv.id}')">Request Interview</button>`;
    return;
  }

  const statusLabel = `<span class="role-badge role-badge--grey">${escHtml(interview.status)}</span>`;
  let meetPart = '';
  if (interview.meet_link && interview.status === 'scheduled' && isValidMeetLink(interview.meet_link)) {
    const safeLink = escHtml(interview.meet_link);
    meetPart = `<a class="btn btn--sm btn--outline" href="${safeLink}" target="_blank" rel="noopener">Join Interview</a>`;
  }

  // If recruiter who created request, allow entering meet link when accepted
  if (interview.recruiter_id === currentUser.id && interview.status === 'accepted') {
    meetPart = `
      <input id="meet-link-input" placeholder="Enter Google Meet link" style="width:220px;margin-right:8px" />
      <button class="btn btn--sm btn--primary" onclick="setMeetLink('${conv.id}')">Save link & Schedule</button>
    `;
  }

  wrap.innerHTML = `
    <span style="margin-left:8px">Interview: ${statusLabel}</span>
    <span style="margin-left:8px">${meetPart}</span>
  `;
}

async function requestInterview(convId) {
  if (!convId) return;
  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return showToast('Conversation not found', 'error');
  const confirmReq = confirm('Send interview request to this student?');
  if (!confirmReq) return;

  const { error } = await window.sb.rpc('request_interview', {
    p_conversation_id: convId
  });

  if (error) { showToast('Failed to request interview: ' + error.message, 'error'); return; }
  showToast('Interview requested.', 'success');
  await loadConversations(true);
  await openConversation(convId);
}

async function setMeetLink(convId) {
  const input = document.getElementById('meet-link-input');
  if (!input) return showToast('Enter a meet link first', 'error');
  const link = input.value.trim();
  if (!isValidMeetLink(link)) return showToast('Enter a valid https://meet.google.com link', 'error');
  const { error } = await window.sb.rpc('schedule_interview', {
    p_conversation_id: convId,
    p_meet_link: link
  });
  if (error) { showToast('Failed to save meet link: ' + error.message, 'error'); return; }
  showToast('Meet link saved and interview scheduled.', 'success');
  await loadConversations(true);
  await openConversation(convId);
}

function joinInterview(link) {
  if (!link) return;
  window.open(link, '_blank');
}

async function reportConversation(conversationId, reportedUserId) {
  if (!reportedUserId) return;
  const reason = prompt('Please tell us why you are reporting this user:');
  const { error } = await window.sb.from('moderation_reports').insert({
    reporter_id: currentUser.id,
    reported_user_id: reportedUserId,
    conversation_id: conversationId,
    reason_detail: reason || null,
    reason_category: 'Other'
  });
  if (error) { showToast('Failed to submit report: ' + error.message, 'error'); return; }
  showToast('Report submitted. Thank you.', 'success');
}

async function blockConversationPartner(blockedUserId) {
  if (!blockedUserId) return;
  if (!confirm('Block this user and stop further messages?')) return;
  const { error } = await window.sb.from('blocked_users').insert({ blocker_id: currentUser.id, blocked_id: blockedUserId });
  if (error) { showToast('Failed to block user: ' + error.message, 'error'); return; }
  showToast('User blocked.', 'warn');
  await loadConversations(true);
  renderChatActions(null);
}

async function loadConversationMessages(convId) {
  const { data, error } = await window.sb
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .range(0, MESSAGE_PAGE_SIZE - 1);

  if (error) {
    showToast('Failed to load thread', 'error');
    return;
  }

  const pane = document.getElementById('chat-messages');
  if (!pane) return;
  const ordered = [...(data || [])].reverse();
  const unreadIncoming = ordered.filter(message => message.sender_id !== currentUser.id && !message.read).map(message => message.id);
  if (unreadIncoming.length) {
    const { error: readError } = await window.sb.rpc('mark_conversation_read', { p_conversation_id: convId });
    if (readError) console.warn('Failed to mark recruiter thread as read', readError);
    ordered.forEach(message => {
      if (unreadIncoming.includes(message.id)) message.read = true;
    });
  }

  if (!ordered.length) {
    pane.innerHTML = '<div class="chat-empty">No messages in this thread yet.</div>';
    return;
  }

  pane.innerHTML = ordered.map(message => {
    const mine = message.sender_id === currentUser.id;
    return `
      <div class="chat-row ${mine ? 'chat-row--mine' : ''}">
        <div class="chat-bubble ${mine ? 'chat-bubble--mine' : ''}">
          <div class="chat-bubble__text">${escHtml(message.body)}</div>
          <div class="chat-bubble__meta">${fmtTime(message.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');

  pane.scrollTop = pane.scrollHeight;
  const activeThread = myMessages.find(message => message.id === convId);
  if (activeThread) {
    activeThread.message_feed = [...ordered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    activeThread.last_message = activeThread.message_feed[0] || null;
    activeThread.unread_count = 0;
  }
  renderConversations();
  updateDashboardStats();
}

// --- Trust & Safety UI helpers
async function reportMessage(messageId, conversationId, reportedUserId) {
  const reason = prompt('Why are you reporting this message? (optional)') || '';
  const { error } = await window.sb.from('moderation_reports').insert({
    reporter_id: currentUser.id,
    reported_user_id: reportedUserId,
    reported_message_id: messageId,
    conversation_id: conversationId,
    reason_detail: reason || null,
    reason_category: 'Other'
  });
  if (error) { showToast('Failed to submit report: ' + error.message, 'error'); return; }
  showToast('Report submitted. Thank you.', 'success');
}

async function blockUser(blockedUserId) {
  if (!confirm('Block this user? You will no longer receive messages from them.')) return;
  const { error } = await window.sb.from('blocked_users').insert({ blocker_id: currentUser.id, blocked_id: blockedUserId });
  if (error) { showToast('Failed to block user: ' + error.message, 'error'); return; }
  showToast('User blocked', 'warn');
  // refresh conversations to reflect block
  await loadConversations(true);
  await renderConversations();
}

async function sendRecruiterMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || !currentConversation) return;

  const body = input.value.trim().slice(0, 1000);
  const sendBtn = document.getElementById('chat-send-btn');
  setBtnLoading(sendBtn, true, 'Sending...');

  const { error } = await window.sb.from('messages').insert({
    conversation_id: currentConversation,
    sender_id: currentUser.id,
    body
  });

  setBtnLoading(sendBtn, false);
  if (error) {
    showToast(`Failed to send: ${error.message}`, 'error');
    return;
  }

  input.value = '';
  await loadConversations(true);
  await openConversation(currentConversation);
}

function renderEmptyChatState() {
  const pane = document.getElementById('chat-messages');
  const title = document.getElementById('chat-title');
  const meta = document.getElementById('chat-meta');
  const badge = document.getElementById('chat-trust-badge');

  if (title) title.textContent = 'Select a thread';
  if (meta) meta.textContent = 'Your creator conversations will appear here.';
  if (badge) {
    badge.textContent = currentProfile?.verified_recruiter ? 'Verified recruiter' : 'Verification pending';
    badge.className = `thread-status-badge ${currentProfile?.verified_recruiter ? 'thread-status-badge--ok' : ''}`;
  }
  if (pane) {
    pane.innerHTML = `
      <div class="chat-empty">
        <strong>Direct messages, without the cold-email feel.</strong>
        <span>Open a creator profile, send a short note, and the full conversation will stay here.</span>
      </div>
    `;
  }
}

function getThreadStatus(conversation) {
  const last = conversation?.last_message;
  if (!last) return 'No activity';
  if (conversation.unread_count > 0) return conversation.unread_count === 1 ? 'New reply' : `${conversation.unread_count} unread`;
  if (last.sender_id === currentUser.id) return last.read ? 'Seen' : 'Sent';
  return 'Replied';
}

function subscribeToRecruiterThread(convId) {
  if (!window.sb || !convId) return;
  if (recruiterThreadChannel) {
    recruiterThreadChannel.unsubscribe();
    recruiterThreadChannel = null;
  }

  recruiterThreadChannel = window.sb
    .channel(`recruiter-thread-${convId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, () => {
      loadConversations(true);
      loadConversationMessages(convId);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'interviews', filter: `conversation_id=eq.${convId}` }, () => renderRecruiterInterviewUI(myMessages.find(conv => conv.id === convId)))
    .subscribe();
}

function startRealtimeSync() {
  if (!window.sb || !currentUser?.id || recruiterRealtimeChannel) return;
  recruiterRealtimeChannel = window.sb
    .channel(`recruiter-live-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `recruiter_id=eq.${currentUser.id}` }, () => loadConversations(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => loadNotifications())
    .subscribe();
}

function startChatRefresh() {
  stopChatRefresh();
}

function stopChatRefresh() {
  if (recruiterThreadChannel) {
    recruiterThreadChannel.unsubscribe();
    recruiterThreadChannel = null;
  }
  if (chatRefreshTimer) {
    window.clearInterval(chatRefreshTimer);
    chatRefreshTimer = null;
  }
}

async function toggleShortlist(projectId) {
  const isShortlisted = shortlistProjectIds.includes(projectId);

  if (isShortlisted) {
    const { error } = await window.sb
      .from('shortlists')
      .delete()
      .eq('recruiter_id', currentUser.id)
      .eq('project_id', projectId);

    if (error) {
      showToast(`Failed to update shortlist: ${error.message}`, 'error');
      return;
    }

    shortlistProjectIds = shortlistProjectIds.filter(id => id !== projectId);
    showToast('Removed from shortlist', 'warn');
  } else {
    const { error } = await window.sb
      .from('shortlists')
      .insert({
        recruiter_id: currentUser.id,
        project_id: projectId
      });

    if (error) {
      showToast(`Failed to update shortlist: ${error.message}`, 'error');
      return;
    }

    shortlistProjectIds.push(projectId);
    showToast('Added to shortlist.', 'success');
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

  const shortlisted = allProjects.filter(project => shortlistProjectIds.includes(project.id));
  if (!shortlisted.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = shortlisted.map(project => `
    <div class="student-card animate-fade-up">
      <div class="student-card__top">
        <div class="student-avatar">${getInitials(project.builderName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(project.title)}</h3>
          <p class="student-card__headline">${escHtml(project.builderName)}</p>
        </div>
        <button class="shortlist-btn shortlisted" onclick="event.stopPropagation();toggleShortlist('${project.id}')">★</button>
      </div>
      <div class="student-card__footer">
        <span class="role-badge role-badge--grey">${escHtml(project.project_type)}</span>
        <span class="muted">${escHtml(project.builderLocation || 'Location not shared')}</span>
      </div>
      <div class="student-card__actions">
        <button class="btn btn--sm btn--primary" onclick="openProjectDetail('${project.id}')">View project</button>
        <button class="btn btn--sm btn--outline" onclick="openMessageComposer('${project.id}')">Message creator</button>
      </div>
    </div>
  `).join('');
}

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
    .order('created_at', { ascending: false })
    .range(0, CONVERSATION_PAGE_SIZE - 1);

  if (error) {
    showToast('Failed to load notifications', 'error');
    return;
  }

  myNotifications = data || [];
  renderNotifications();
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
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  list.innerHTML = myNotifications.map(note => {
    const title = note.type === 'contact_request'
      ? 'Message activity'
      : note.type === 'project_feature'
        ? `Project ${note.payload?.featured ? 'featured' : 'updated'}`
        : note.type === 'recruiter_verified'
          ? 'Recruiter status updated'
          : 'Notification';
    const body = note.payload?.message || note.payload?.title || note.payload?.detail || 'You have a new update.';

    return `
      <div class="card notification-card animate-fade-up">
        <div class="notification-card__row">
          <div>
            <strong>${escHtml(title)}</strong>
            <div class="muted notification-card__body">${escHtml(body)}</div>
          </div>
          <span class="role-badge role-badge--grey">${fmtDate(note.created_at)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function setupSearch() {
  const searchInput = document.getElementById('search-input');
  const locFilter = document.getElementById('filter-location');
  const availFilter = document.getElementById('filter-availability');
  const projectType = document.getElementById('filter-project-type');
  const ageMin = document.getElementById('filter-age-min');
  const ageMax = document.getElementById('filter-age-max');

  searchInput?.addEventListener('input', applyFilters);
  locFilter?.addEventListener('input', applyFilters);
  availFilter?.addEventListener('change', applyFilters);
  projectType?.addEventListener('change', applyFilters);
  ageMin?.addEventListener('input', applyFilters);
  ageMax?.addEventListener('input', applyFilters);
}

function getFilteredProjects() {
  const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  const loc = document.getElementById('filter-location')?.value || '';
  const avail = document.getElementById('filter-availability')?.value || '';
  const type = document.getElementById('filter-project-type')?.value || '';
  const minAge = parseInt(document.getElementById('filter-age-min')?.value, 10);
  const maxAge = parseInt(document.getElementById('filter-age-max')?.value, 10);

  return allProjects.filter(project => {
    if (q && !project.title.toLowerCase().includes(q) && !project.builderName.toLowerCase().includes(q) && !project.description.toLowerCase().includes(q) && !project.tech_stack.some(skill => skill.toLowerCase().includes(q))) return false;
    if (loc && !project.builderLocation.toLowerCase().includes(loc.toLowerCase())) return false;
    if (avail && project.builderAvailability !== avail) return false;
    if (type && project.project_type !== type) return false;
    if (!Number.isNaN(minAge) && (project.builderAge === null || project.builderAge < minAge)) return false;
    if (!Number.isNaN(maxAge) && (project.builderAge === null || project.builderAge > maxAge)) return false;
    if (filterSkills.length && !filterSkills.every(filterSkill => project.tech_stack.some(skill => skill.toLowerCase() === filterSkill.toLowerCase()))) return false;
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
  document.getElementById('filter-skills-wrap')?.querySelectorAll('.skill-tag').forEach(tag => tag.remove());
  renderProjects(allProjects);
}

function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(node => node.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(node => node.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');

  if (section === 'shortlist') renderShortlist();
  if (section === 'notifications') renderNotifications();
  if (section === 'messages') {
    renderConversations();
    if (!currentConversation) renderEmptyChatState();
  }
}

async function logout() {
  stopChatRefresh();
  await Auth.signOut();
  window.location.href = '/index.html';
}

window.openMessageComposer = openMessageComposer;
window.closeMessageComposer = closeMessageComposer;
window.closeStudentModal = closeStudentModal;
window.renderProjectDetail = renderProjectDetail;
window.toggleShortlist = toggleShortlist;
window.openProjectDetail = openProjectDetail;
window.showSection = showSection;
window.clearFilters = clearFilters;
window.logout = logout;

document.addEventListener('DOMContentLoaded', initRecruiter);
window.addEventListener('beforeunload', stopChatRefresh);
