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
let communityCreators = [];
let communityGroups = [];
let profileSkills = [];
let projectSkills = [];
let editProjectSkills = [];
let editingProjectId = null;
let currentConversation = null;
let conversationRefreshTimer = null;
let creatorComposeTarget = null;
let studentRealtimeChannel = null;
let studentThreadChannel = null;
let groupRealtimeChannel = null;
let currentGroupId = null;
let filterCommunitySkills = [];      // for server-side skills filtering
let communitySearchTimer = null;     // debounce timer

const COMMUNITY_PAGE_SIZE = 24;
const CONVERSATION_PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 50;

function normalizeProfileJoin(profileJoin) {
  if (Array.isArray(profileJoin)) return profileJoin[0] || null;
  return profileJoin || null;
}

function getUnreadCountFromFeed(messageFeed = []) {
  return messageFeed.filter(message => message.sender_id !== currentUser?.id && !message.read).length;
}

function isValidMeetLink(link) {
  return /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test((link || '').trim());
}

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
  const composerAvatar = document.getElementById('composer-avatar');
  if (composerAvatar) composerAvatar.textContent = initials;
  const profileAvatarPreview = document.getElementById('profile-avatar-preview');
  if (profileAvatarPreview) profileAvatarPreview.textContent = initials;

  await ensureStudentPolicyAccepted();

  initForms();
  await loadStudentProfile();
  await Promise.all([loadProjects(), loadCommunityProjects(), loadCommunityCreators(), loadCommunityGroups(), loadNotifications(), loadActivity(), loadConversations()]);
  setupMessagingComposer();
  startRealtimeSync();
  const ovName = document.getElementById('overview-name');
  if (ovName) ovName.textContent = currentProfile.full_name || currentUser.email;
  showSection('overview');
  startConversationRefresh();
}

async function ensureStudentPolicyAccepted() {
  const { data, error } = await window.sb
    .from('student_onboarding_acceptances')
    .select('id')
    .eq('student_id', currentUser.id)
    .limit(1);

  if (error) {
    console.warn('Unable to verify student guidelines acceptance', error);
    return;
  }

  if (!data || !data.length) {
    showStudentPolicyModal();
    await new Promise(resolve => { window.__studentPolicyResolve = resolve; });
  }
}

function showStudentPolicyModal() {
  document.getElementById('student-policy-modal')?.classList.remove('hidden');
  const btn = document.getElementById('accept-student-policy-btn');
  if (btn) btn.onclick = acceptStudentPolicy;
}

function hideStudentPolicyModal() {
  document.getElementById('student-policy-modal')?.classList.add('hidden');
}

async function acceptStudentPolicy() {
  const { error } = await window.sb.from('student_onboarding_acceptances').insert({
    student_id: currentUser.id,
    ip_address: window.location.hostname || ''
  });
  if (error) {
    showToast('Unable to save acceptance: ' + error.message, 'error');
    return;
  }
  hideStudentPolicyModal();
  if (window.__studentPolicyResolve) {
    window.__studentPolicyResolve();
    window.__studentPolicyResolve = null;
  }
  showToast('Thanks for accepting the community guidelines.', 'success');
}

// ── LOAD STUDENT PROFILE ─────────────────────────────────
// FIX: uses maybeSingle() instead of single(), and upserts a
// blank row when none exists so saves never silently fail.
async function loadStudentProfile() {
  const { data, error } = await window.sb
    .from('student_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.warn('Failed to load student profile', error);
    return;
  }

  if (!data) {
    // No profile row yet — create one so subsequent saves work.
    const { error: insertError } = await window.sb
      .from('student_profiles')
      .insert({ user_id: currentUser.id });
    if (insertError && insertError.code !== '23505') {
      console.warn('Failed to create profile row', insertError);
    }
    // Re-fetch after insert
    const { data: fresh } = await window.sb
      .from('student_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (fresh) {
      currentProfile = { ...currentProfile, ...fresh };
      populateProfileForm(fresh);
      updateOverviewCard(fresh);
    }
    return;
  }

  currentProfile = { ...currentProfile, ...data };
  populateProfileForm(data);
  updateOverviewCard(data);
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
  updateAvatarPreview(profile.avatar_url, profile.full_name || currentProfile?.full_name || currentUser?.email);
  const visibilityEl = document.getElementById('profile-visibility');
  if (visibilityEl) visibilityEl.value = profile.visibility || 'public';
  const githubEl = document.getElementById('profile-github');
  if (githubEl) githubEl.value = profile.github_username || '';

  // Populate skills
  profileSkills.length = 0;
  document.getElementById('profile-skills-wrap')
    ?.querySelectorAll('.skill-tag').forEach(t => t.remove());

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
    visibility.textContent = 'Public';
    visibility.title = 'Your profile is visible and searchable. Add more details whenever you want.';
  }

  const scoreBar = document.getElementById('overview-score-bar');
  if (scoreBar) scoreBar.style.width = '100%';
  updateProfilePrompt(profile);
}

function updateAvatarPreview(url, name) {
  const targets = [
    document.getElementById('user-avatar'),
    document.getElementById('composer-avatar'),
    document.getElementById('profile-avatar-preview')
  ].filter(Boolean);
  const initials = getThreadInitials(name || currentUser?.email || 'Builder');
  targets.forEach(target => {
    target.textContent = url ? '' : initials;
    target.style.backgroundImage = url ? `url("${url}")` : '';
  });
}

function calculateProfileScore(profile) {
  return 100;
}

function updateProfilePrompt(profile) {
  const prompt = document.getElementById('profile-prompt');
  if (!prompt) return;
  const strong = prompt.querySelector('.prompt-banner__text strong');
  const span = prompt.querySelector('.prompt-banner__text span');
  const actionBtn = prompt.querySelector('.btn');
  const discoverable = true;

  if (discoverable) {
    if (strong) strong.textContent = 'You are live on Solvoriz';
    if (span) span.textContent = 'Your profile is searchable now. Add bio, avatar, skills, and projects later to give people more context.';
    if (actionBtn) actionBtn.textContent = profile?.headline || profile?.bio ? 'Polish profile' : 'Add details';
    prompt.style.borderColor = 'rgba(14,122,80,.2)';
    prompt.style.background = 'linear-gradient(135deg, rgba(14,122,80,.08) 0%, rgba(14,122,80,.04) 100%)';
    return;
  }

  const missing = [];
  if (false) missing.push('add a few more profile details');
  if ((profile?.visibility || 'public') === 'hidden') missing.push('switch visibility to public');
  if (false) missing.push('add at least one visible project');

  if (strong) strong.textContent = 'Complete your profile to get discovered';
  if (span) span.textContent = missing.length
    ? `Before recruiters can find you, you still need to ${missing.join(', ')}.`
    : 'Add a headline, skills, and a project when you are ready.';
  if (actionBtn) actionBtn.textContent = 'Add details';
  prompt.style.borderColor = 'rgba(24,71,248,.2)';
  prompt.style.background = 'linear-gradient(135deg, rgba(24,71,248,.08) 0%, rgba(24,71,248,.04) 100%)';
}

// FIX: uses upsert so it works even when no profile row exists yet
async function syncDiscoverability() {
  const discoverable = true;

  if (currentProfile) currentProfile.discoverable = discoverable;

  if (!currentUser?.id) return;
  const { error } = await window.sb
    .from('student_profiles')
    .upsert({ user_id: currentUser.id, discoverable }, { onConflict: 'user_id' });

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
    .order('created_at', { ascending: false })
    .range(0, CONVERSATION_PAGE_SIZE - 1);
  if (error) { showToast('Failed to load notifications', 'error'); return; }
  myNotifications = data || [];
  renderNotifications();
}

// ── COMMUNITY: LOAD PROJECTS ──────────────────────────────
async function loadCommunityProjects() {
  const { data, error } = await window.sb.rpc('list_creator_projects', {
    p_limit: COMMUNITY_PAGE_SIZE,
    p_offset: 0
  });

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
    creatorName: project.creator_name || 'Creator',
    creatorHeadline: project.creator_headline || '',
    creatorLocation: project.creator_location || '',
    creatorAvailability: project.creator_availability || '',
    creatorAvatar: project.creator_avatar || '',
    creatorFeatured: Boolean(project.creator_featured),
    creatorDiscoverable: Boolean(project.creator_discoverable),
    creatorReviewStatus: project.creator_review_status || 'pending',
    creatorVisibility: project.creator_visibility || 'public'
  })).filter(project =>
    project.userId !== currentUser.id &&
    project.creatorVisibility === 'public' &&
    project.creatorReviewStatus !== 'flagged'
  );

  renderCommunityProjects();
}

// ── COMMUNITY: LOAD CREATORS (server-side search) ─────────
// FIX: now passes p_search, p_skills, p_availability to the DB
// instead of loading everything and filtering client-side.
async function loadCommunityCreators(searchQuery = '', availFilter = '') {
  const { data, error } = await window.sb.rpc('list_creator_directory', {
    p_limit: COMMUNITY_PAGE_SIZE * 2,
    p_offset: 0,
    p_search: searchQuery || null,
    p_skills: filterCommunitySkills.length ? filterCommunitySkills : null,
    p_availability: availFilter || null
  });

  if (error) {
    console.warn('Failed to load creator directory', error);
    return;
  }

  communityCreators = (data || []).map(creator => ({
    userId: creator.user_id,
    handle: creator.handle || '',
    creatorName: creator.creator_name || 'Creator',
    creatorHeadline: creator.creator_headline || '',
    creatorLocation: creator.creator_location || '',
    creatorAvailability: creator.creator_availability || '',
    creatorAvatar: creator.creator_avatar || '',
    creatorFeatured: Boolean(creator.creator_featured),
    creatorDiscoverable: Boolean(creator.creator_discoverable),
    creatorReviewStatus: creator.creator_review_status || 'pending',
    creatorVisibility: creator.creator_visibility || 'public',
    githubUsername: creator.github_username || '',
    skills: creator.skills || [],
    projectTitles: creator.project_titles || [],
    projectCount: Number(creator.project_count || 0),
    primaryProjectId: creator.primary_project_id || null,
    primaryProjectTitle: creator.primary_project_title || '',
    primaryProjectType: creator.primary_project_type || 'Project'
  })).filter(creator =>
    creator.userId !== currentUser.id &&
    creator.creatorVisibility === 'public' &&
    creator.creatorReviewStatus !== 'flagged'
  );

  renderCommunityCreators();
}

async function loadCommunityGroups() {
  const [{ data: groups, error: groupsError }, { data: memberships, error: membersError }] = await Promise.all([
    window.sb.from('groups').select('*, creator:creator_id(id, full_name, email)').order('created_at', { ascending: false }).limit(24),
    window.sb.from('group_members').select('group_id, role').eq('user_id', currentUser.id)
  ]);

  if (groupsError) {
    console.warn('Failed to load groups', groupsError);
    return;
  }
  if (membersError) console.warn('Failed to load group memberships', membersError);

  const membershipByGroup = Object.fromEntries((memberships || []).map(item => [item.group_id, item]));
  communityGroups = (groups || []).map(group => ({
    ...group,
    joined: Boolean(membershipByGroup[group.id]),
    role: membershipByGroup[group.id]?.role || null
  }));
  renderCommunityGroups();
}

function renderCommunityGroups() {
  const list = document.getElementById('groups-list');
  if (!list) return;

  if (!communityGroups.length) {
    list.innerHTML = '<div class="muted">No rooms yet. Create the first one.</div>';
    return;
  }

  list.innerHTML = communityGroups.map(group => `
    <div class="creator-search-item">
      <div class="student-avatar">${getThreadInitials(group.name)}</div>
      <div class="creator-search-item__body">
        <div class="creator-search-item__top">
          <strong>${escHtml(group.name)}</strong>
          <span class="muted">${group.joined ? escHtml(group.role || 'member') : 'open group'}</span>
        </div>
        <div class="creator-search-item__bio">${escHtml(group.description || 'Casual builder discussion space.')}</div>
        <div class="muted">Created by ${escHtml(group.creator?.full_name || group.creator?.email || 'a Solvoriz builder')}</div>
      </div>
      ${group.joined
        ? `<button class="btn btn--sm btn--primary" onclick="openGroupChat('${group.id}')">Open chat</button>`
        : `<button class="btn btn--sm btn--outline" onclick="joinCommunityGroup('${group.id}')">Join</button>`}
    </div>
  `).join('');
}

async function createCommunityGroup(event) {
  event.preventDefault();
  const name = document.getElementById('group-name')?.value.trim();
  const description = document.getElementById('group-description')?.value.trim();
  if (!name) return;

  const btn = event.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Creating...');
  const { data, error } = await window.sb.rpc('create_group', {
    p_name: name,
    p_description: description || null
  });
  setBtnLoading(btn, false);

  if (error) { showToast(`Failed to create group: ${error.message}`, 'error'); return; }
  event.target.reset();
  showToast('Room created.', 'success');
  await loadCommunityGroups();
  if (data?.id) await openGroupChat(data.id);
}

async function joinCommunityGroup(groupId) {
  const { error } = await window.sb.rpc('join_group', { p_group_id: groupId });
  if (error) { showToast(`Failed to join group: ${error.message}`, 'error'); return; }
  showToast('Joined group.', 'success');
  await loadCommunityGroups();
  await openGroupChat(groupId);
}

async function openGroupChat(groupId) {
  currentGroupId = groupId;
  const group = communityGroups.find(item => item.id === groupId);
  document.getElementById('group-chat-panel')?.classList.remove('hidden');
  const title = document.getElementById('group-chat-title');
  const meta = document.getElementById('group-chat-meta');
  if (title) title.textContent = group?.name || 'Group chat';
  if (meta) meta.textContent = group?.description || 'Creator discussion space';

  subscribeToGroupChat(groupId);
  await loadGroupMessages(groupId);
}

async function loadGroupMessages(groupId) {
  const { data, error } = await window.sb
    .from('group_messages')
    .select('*, sender:sender_id(id, full_name, email)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(60);

  if (error) { showToast('Failed to load group chat', 'error'); return; }
  const pane = document.getElementById('group-chat-messages');
  if (!pane) return;
  if (!data?.length) {
    pane.innerHTML = '<div class="chat-empty">No messages yet. Drop the first idea.</div>';
    return;
  }
  pane.innerHTML = data.map(message => `
    <div class="chat-row ${message.sender_id === currentUser.id ? 'chat-row--mine' : ''}">
      <div class="chat-bubble ${message.sender_id === currentUser.id ? 'chat-bubble--mine' : ''}">
        <div class="chat-bubble__meta">${escHtml(message.sender?.full_name || message.sender?.email || 'Builder')} · ${fmtTime(message.created_at)}</div>
        <div class="chat-bubble__text">${escHtml(message.body)}</div>
      </div>
    </div>
  `).join('');
  pane.scrollTop = pane.scrollHeight;
}

async function sendGroupMessage() {
  const input = document.getElementById('group-chat-input');
  const body = input?.value.trim().slice(0, 1000) || '';
  if (!currentGroupId || !body) return;

  const btn = document.getElementById('group-chat-send-btn');
  setBtnLoading(btn, true, 'Sending...');
  const { error } = await window.sb.from('group_messages').insert({
    group_id: currentGroupId,
    sender_id: currentUser.id,
    body
  });
  setBtnLoading(btn, false);
  if (error) { showToast(`Failed to send: ${error.message}`, 'error'); return; }
  if (input) input.value = '';
  await loadGroupMessages(currentGroupId);
}

function subscribeToGroupChat(groupId) {
  if (!window.sb || !groupId) return;
  if (groupRealtimeChannel) { groupRealtimeChannel.unsubscribe(); groupRealtimeChannel = null; }
  groupRealtimeChannel = window.sb
    .channel(`group-chat-${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, () => loadGroupMessages(groupId))
    .subscribe();
}

// ── COMMUNITY: RENDER PROJECTS ────────────────────────────
function renderCommunityProjects() {
  const grid = document.getElementById('community-grid');
  const empty = document.getElementById('community-empty');
  if (!grid) return;

  // Projects still filter client-side (small set, fast)
  const q = getCommunityQuery();
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
            ${project.creatorFeatured ? '<span class="role-badge role-badge--recruiter">Featured</span>' : ''}
            ${project.creatorDiscoverable ? '<span class="role-badge role-badge--success">Public creator</span>' : '<span class="role-badge role-badge--grey">Community member</span>'}
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

// ── COMMUNITY: RENDER CREATORS ────────────────────────────
function renderCommunityCreatorsCardLayout() {
  const grid = document.getElementById('creator-directory-grid');
  const empty = document.getElementById('creator-directory-empty');
  if (!grid) return;

  // Creators are already filtered server-side; just render what came back.
  if (!communityCreators.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = communityCreators.map(creator => `
    <div class="student-card animate-fade-up" style="cursor:default">
      <div class="student-card__top">
        <div class="student-avatar">${getThreadInitials(creator.creatorName)}</div>
        <div class="student-card__info">
          <h3 class="student-card__name">${escHtml(creator.creatorName)}</h3>
          <p class="student-card__headline">${escHtml(creator.creatorHeadline || (creator.handle ? '@' + creator.handle : 'Student creator'))}</p>
          <div class="student-card__meta">
            ${creator.creatorFeatured ? '<span class="role-badge role-badge--recruiter">Featured</span>' : ''}
            ${creator.creatorDiscoverable ? '<span class="role-badge role-badge--success">Discoverable</span>' : '<span class="role-badge role-badge--grey">Community member</span>'}
            ${creator.handle ? `<span class="role-badge role-badge--grey">@${escHtml(creator.handle)}</span>` : ''}
          </div>
        </div>
      </div>
      <p class="student-card__summary">${escHtml(creator.creatorHeadline || 'Browse this creator through skills, projects, and availability.')}</p>
      <div class="skill-chips-row skill-chips-row--sm" style="margin:8px 0 10px">
        ${(creator.skills || []).slice(0, 5).map(skill => `<span class="skill-chip skill-chip--sm">${escHtml(skill)}</span>`).join('')}
      </div>
      <div class="muted">${creator.projectCount} public project${creator.projectCount === 1 ? '' : 's'}${creator.primaryProjectTitle ? ` · Latest: ${escHtml(creator.primaryProjectTitle)}` : ''}</div>
      <div class="student-card__footer">
        ${creator.creatorLocation ? `<span class="muted">${escHtml(creator.creatorLocation)}</span>` : '<span class="muted">Location not shared</span>'}
        ${creator.creatorAvailability ? `<span class="role-badge role-badge--${creator.creatorAvailability === 'available' ? 'success' : 'grey'}">${escHtml(creator.creatorAvailability)}</span>` : ''}
      </div>
      <div class="student-card__actions">
        ${creator.githubUsername ? `<a class="btn btn--sm btn--outline" href="https://github.com/${escHtml(creator.githubUsername)}" target="_blank" rel="noopener">GitHub</a>` : '<button class="btn btn--sm btn--outline" disabled>No GitHub</button>'}
        <button class="btn btn--sm btn--primary" onclick="openCreatorConnection('${creator.userId}')">Message</button>
      </div>
    </div>
  `).join('');
}

function getCommunityQuery() {
  return document.getElementById('community-search-input')?.value.trim().toLowerCase() || '';
}

// ── CONVERSATIONS ─────────────────────────────────────────
async function loadConversations() {
  const { data, error } = await window.sb
    .from('conversations')
    .select(`*, recruiter:recruiter_id(id, full_name, email), student:student_id(id, full_name, email), project:project_id(id, title), last_message:messages (id, body, created_at, sender_id, read)`)
    .or(`student_id.eq.${currentUser.id},recruiter_id.eq.${currentUser.id}`)
    .order('last_message_at', { ascending: false })
    .range(0, CONVERSATION_PAGE_SIZE - 1);

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
    .order('last_message_at', { ascending: false })
    .range(0, CONVERSATION_PAGE_SIZE - 1);

  if (error) { console.warn('Failed to load recruiter conversations', error); }
  if (creatorError) { console.warn('Failed to load creator conversations', creatorError); }

  const recruiterMessages = (data || []).map(conv => {
    const partner = conv.recruiter_id === currentUser.id ? conv.student : conv.recruiter;
    return {
      ...conv,
      threadType: 'direct',
      partnerId: partner?.id || (conv.recruiter_id === currentUser.id ? conv.student_id : conv.recruiter_id),
      partnerName: partner?.full_name || partner?.email || 'Solvoriz user',
      partnerRoleLabel: 'Direct message',
      message_feed: Array.isArray(conv.last_message)
        ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : conv.last_message ? [conv.last_message] : [],
      last_message: Array.isArray(conv.last_message)
        ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : conv.last_message,
      unread_count: getUnreadCountFromFeed(Array.isArray(conv.last_message) ? conv.last_message : conv.last_message ? [conv.last_message] : [])
    };
  });

  const creatorMessages = (creatorData || []).map(conv => {
    const partner = conv.creator_one_id === currentUser.id ? conv.creator_two : conv.creator_one;
    return {
      ...conv,
      threadType: 'creator',
      partnerName: partner?.full_name || partner?.email || 'Creator',
      partnerRoleLabel: 'Creator discussion',
      message_feed: Array.isArray(conv.last_message)
        ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : conv.last_message ? [conv.last_message] : [],
      last_message: Array.isArray(conv.last_message)
        ? [...conv.last_message].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : conv.last_message,
      unread_count: getUnreadCountFromFeed(Array.isArray(conv.last_message) ? conv.last_message : conv.last_message ? [conv.last_message] : [])
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
  const unreadTotal = myMessages.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
  if (count) count.textContent = String(unreadTotal || myMessages.length || 0);
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
            <div style="display:flex;align-items:center;gap:8px">
              ${c.unread_count ? `<span class="nav-count">${c.unread_count}</span>` : ''}
              <span class="thread-card__time">${fmtTime(last.created_at)}</span>
            </div>
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
    badge.textContent = `${conv.partnerRoleLabel || 'Direct message'} · ${getThreadStatus(conv)}`;
    badge.className = 'thread-status-badge thread-status-badge--ok';
  }
  renderStudentChatActions(conv);
  renderStudentInterviewUI(conv);
  subscribeToStudentThread(conv);
  await loadConversationMessages(convId);
  document.getElementById('chat-send-btn').onclick = sendStudentMessage;
}

function renderStudentChatActions(conv) {
  const container = document.getElementById('chat-actions-top');
  if (!container) return;
  if (!conv) { container.innerHTML = ''; return; }

  let partnerId = null;
  if (conv.threadType === 'direct') {
    partnerId = conv.partnerId;
  } else if (conv.threadType === 'creator') {
    partnerId = conv.creator_one_id === currentUser.id ? conv.creator_two_id : conv.creator_one_id;
  } else {
    partnerId = conv.recruiter?.id;
  }

  container.innerHTML = `
    <button class="btn btn--outline btn--sm" onclick="studentReportConversation('${conv.id}','${partnerId}')">Report user</button>
    <button class="btn btn--danger btn--sm" onclick="studentBlockConversationPartner('${partnerId}')">Block user</button>
  `;
}

async function loadInterviewForStudent(convId) {
  if (!convId) return null;
  const { data, error } = await window.sb.from('interviews').select('*').eq('conversation_id', convId).limit(1).maybeSingle();
  if (error) { console.warn('Failed to load interview', error); return null; }
  return data || null;
}

async function renderStudentInterviewUI(conv) {
  const container = document.getElementById('chat-actions-top');
  if (!container || !conv) return;
  const interview = await loadInterviewForStudent(conv.id);
  let extra = '';
  if (!interview) {
    extra = `<span style="margin-left:8px" class="muted">No interview requested</span>`;
  } else {
    const status = escHtml(interview.status);
    if (interview.status === 'requested') {
      extra = `
        <span style="margin-left:8px">Interview: <strong>Pending</strong></span>
        <button class="btn btn--primary btn--sm" onclick="acceptInterview('${conv.id}')">Accept Interview</button>
        <button class="btn btn--outline btn--sm" onclick="rejectInterview('${conv.id}')">Reject</button>
      `;
    } else if (interview.status === 'accepted') {
      extra = `<span style="margin-left:8px">Interview: <strong>Accepted</strong></span>`;
    } else if (interview.status === 'scheduled' && interview.meet_link && isValidMeetLink(interview.meet_link)) {
      const safeLink = escHtml(interview.meet_link);
      extra = `
        <span style="margin-left:8px">Interview: <strong>Scheduled</strong></span>
        <a class="btn btn--sm btn--outline" href="${safeLink}" target="_blank" rel="noopener">Join Interview</a>
      `;
    } else {
      extra = `<span style="margin-left:8px">Interview: <strong>${status}</strong></span>`;
    }
  }
  container.innerHTML = container.innerHTML + extra;
}

async function acceptInterview(convId) {
  if (!convId) return;
  const { error } = await window.sb.rpc('respond_to_interview_request', {
    p_conversation_id: convId,
    p_decision: 'accepted'
  });
  if (error) { showToast('Failed to accept interview: ' + error.message, 'error'); return; }
  showToast('Interview accepted. Waiting for recruiter to schedule.', 'success');
  await loadConversations();
  await openConversation(convId);
}

async function rejectInterview(convId) {
  if (!convId) return;
  if (!confirm('Reject this interview request?')) return;
  const { error } = await window.sb.rpc('respond_to_interview_request', {
    p_conversation_id: convId,
    p_decision: 'rejected'
  });
  if (error) { showToast('Failed to reject interview: ' + error.message, 'error'); return; }
  showToast('Interview rejected.', 'warn');
  await loadConversations();
  await openConversation(convId);
}

async function studentReportConversation(conversationId, reportedUserId) {
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

async function studentBlockConversationPartner(blockedUserId) {
  if (!blockedUserId) return;
  if (!confirm('Block this user and stop further messages?')) return;
  const { error } = await window.sb.from('blocked_users').insert({ blocker_id: currentUser.id, blocked_id: blockedUserId });
  if (error) { showToast('Failed to block user: ' + error.message, 'error'); return; }
  showToast('User blocked.', 'warn');
  await loadConversations();
  const container = document.getElementById('chat-actions-top');
  if (container) container.innerHTML = '';
}

async function loadConversationMessages(convId) {
  const conv = myMessages.find(c => c.id === convId);
  if (!conv) return;
  const table = conv.threadType === 'creator' ? 'creator_messages' : 'messages';
  const fk = conv.threadType === 'creator' ? 'creator_conversation_id' : 'conversation_id';
  const { data, error } = await window.sb.from(table).select('*').eq(fk, convId).order('created_at', { ascending: false }).range(0, MESSAGE_PAGE_SIZE - 1);
  if (error) { showToast('Failed to load thread', 'error'); return; }
  const ordered = [...(data || [])].reverse();
  const unreadIncoming = ordered.filter(m => m.sender_id !== currentUser.id && !m.read).map(m => m.id);
  if (unreadIncoming.length) {
    const rpcName = conv.threadType === 'creator' ? 'mark_creator_conversation_read' : 'mark_conversation_read';
    const argName = conv.threadType === 'creator' ? 'p_creator_conversation_id' : 'p_conversation_id';
    const { error: readError } = await window.sb.rpc(rpcName, { [argName]: convId });
    if (readError) console.warn('Failed to mark thread as read', readError);
    ordered.forEach(m => { if (unreadIncoming.includes(m.id)) m.read = true; });
  }
  const pane = document.getElementById('chat-messages');
  if (!pane) return;
  if (!ordered.length) {
    pane.innerHTML = '<div class="chat-empty">No messages in this thread yet.</div>';
    return;
  }
  pane.innerHTML = ordered.map(m => `
    <div class="chat-row ${m.sender_id === currentUser.id ? 'chat-row--mine' : ''}">
      <div class="chat-bubble ${m.sender_id === currentUser.id ? 'chat-bubble--mine' : ''}">
        <div class="chat-bubble__text">${escHtml(m.body)}</div>
        <div class="chat-bubble__meta">${fmtTime(m.created_at)}</div>
      </div>
    </div>
  `).join('');
  pane.scrollTop = pane.scrollHeight;
  const activeThread = myMessages.find(message => message.id === convId);
  if (activeThread) {
    activeThread.message_feed = [...ordered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    activeThread.last_message = activeThread.message_feed[0] || null;
    activeThread.unread_count = 0;
  }
  renderConversations();
}

async function sendStudentMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || !currentConversation) return;
  const conv = myMessages.find(c => c.id === currentConversation);
  if (!conv) return;
  const body = input.value.trim().slice(0, 1000);
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendStudentMessage(); }
  });
  creatorComposeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCreatorComposeMessage(); }
  });
}

function renderEmptyConversation() {
  const title = document.getElementById('chat-title');
  const meta = document.getElementById('chat-meta');
  const pane = document.getElementById('chat-messages');
  const badge = document.getElementById('chat-trust-badge');
  if (title) title.textContent = 'Select a thread';
  if (meta) meta.textContent = 'Recruiter outreach and creator discussions stay private inside Solvoriz.';
  if (badge) { badge.textContent = 'Inbox'; badge.className = 'thread-status-badge thread-status-badge--ok'; }
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
  if (conversation.unread_count > 0) return conversation.unread_count === 1 ? 'New reply' : `${conversation.unread_count} unread`;
  if (last.sender_id === currentUser.id) return last.read ? 'Seen' : 'Sent';
  return 'Replied';
}

function subscribeToStudentThread(conversation) {
  if (!window.sb || !conversation?.id) return;
  if (studentThreadChannel) { studentThreadChannel.unsubscribe(); studentThreadChannel = null; }

  const table = conversation.threadType === 'creator' ? 'creator_messages' : 'messages';
  const key = conversation.threadType === 'creator' ? 'creator_conversation_id' : 'conversation_id';
  studentThreadChannel = window.sb
    .channel(`student-thread-${conversation.threadType}-${conversation.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: `${key}=eq.${conversation.id}` }, () => {
      loadConversations();
      loadConversationMessages(conversation.id);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'interviews', filter: `conversation_id=eq.${conversation.id}` }, () => {
      if (conversation.threadType === 'recruiter') renderStudentInterviewUI(myMessages.find(item => item.id === conversation.id));
    })
    .subscribe();
}

// ── CREATOR COMPOSE MODAL ─────────────────────────────────
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

function openCreatorConnection(userId) {
  const creator = communityCreators.find(item => item.userId === userId);
  if (!creator) {
    showToast('Creator not found.', 'warn');
    return;
  }

  creatorComposeTarget = {
    id: creator.primaryProjectId || null,
    userId: creator.userId,
    title: creator.primaryProjectTitle || 'Direct message',
    project_type: creator.primaryProjectType || 'Project',
    creatorName: creator.creatorName,
    creatorHeadline: creator.creatorHeadline,
    creatorLocation: creator.creatorLocation,
    creatorAvailability: creator.creatorAvailability,
    creatorFeatured: creator.creatorFeatured,
    creatorDiscoverable: creator.creatorDiscoverable
  };

  const modal = document.getElementById('creator-compose-modal');
  const avatar = document.getElementById('creator-compose-avatar');
  const name = document.getElementById('creator-compose-name');
  const meta = document.getElementById('creator-compose-meta');
  const copy = document.getElementById('creator-compose-copy');
  const input = document.getElementById('creator-compose-input');
  if (avatar) avatar.textContent = getThreadInitials(creator.creatorName);
  if (name) name.textContent = creator.creatorName;
  if (meta) meta.textContent = `${creator.primaryProjectTitle || 'Public project'} · ${creator.primaryProjectType || 'Project'}`;
  if (copy) copy.textContent = `Start a direct conversation with ${creator.creatorName}. No project context required.`;
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
  if (!conversation) { setBtnLoading(sendBtn, false); return; }

  const { error } = await window.sb.from('messages').insert({
    conversation_id: conversation.id,
    sender_id: currentUser.id,
    body
  });

  setBtnLoading(sendBtn, false);
  if (error) { showToast(`Failed to send: ${error.message}`, 'error'); return; }

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
  const { data, error } = await window.sb.rpc('ensure_direct_conversation', {
    p_other_user_id: otherCreatorId,
    p_project_id: projectId || null
  });

  if (error) { showToast(`Failed to start conversation: ${error.message}`, 'error'); return null; }
  return data;
}

// ── REALTIME ──────────────────────────────────────────────
function startConversationRefresh() {
  stopConversationRefresh();
}

function stopConversationRefresh() {
  if (studentThreadChannel) { studentThreadChannel.unsubscribe(); studentThreadChannel = null; }
  if (groupRealtimeChannel) { groupRealtimeChannel.unsubscribe(); groupRealtimeChannel = null; }
  if (conversationRefreshTimer) { window.clearInterval(conversationRefreshTimer); conversationRefreshTimer = null; }
}

function startRealtimeSync() {
  if (!window.sb || !currentUser?.id || studentRealtimeChannel) return;
  studentRealtimeChannel = window.sb
    .channel(`student-live-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `student_id=eq.${currentUser.id}` }, () => loadConversations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `recruiter_id=eq.${currentUser.id}` }, () => loadConversations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_conversations', filter: `creator_one_id=eq.${currentUser.id}` }, () => loadConversations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_conversations', filter: `creator_two_id=eq.${currentUser.id}` }, () => loadConversations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => loadNotifications())
    .subscribe();
}

// ── ACTIVITY ──────────────────────────────────────────────
async function loadActivity() {
  const { data, error } = await window.sb
    .from('activity_log')
    .select(`*, actor:actor_id (id, full_name, email, student_profiles(headline, location))`)
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
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = myActivity.map(act => {
    let icon, title, desc;
    const actor = act.actor?.[0];
    const actorName = actor?.full_name || actor?.email || 'Someone';
    const actorHeadline = actor?.student_profiles?.[0]?.headline || '';

    if (act.action_type === 'profile_view') { icon = '👀'; title = 'Profile viewed'; desc = `${actorName} viewed your profile`; }
    else if (act.action_type === 'project_view') { icon = '🔍'; title = 'Project viewed'; desc = `${actorName} viewed your project`; }
    else if (act.action_type === 'shortlist') { icon = '⭐'; title = 'Added to shortlist'; desc = `${actorName} shortlisted your project`; }
    else if (act.action_type === 'contact_sent') { icon = '💬'; title = 'Message received'; desc = `${actorName} sent you a message`; }
    else { icon = '📌'; title = 'Activity'; desc = act.action_type; }

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

// ── NOTIFICATIONS ─────────────────────────────────────────
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
              <div class="muted" style="margin-top:6px;max-width:400px">${escHtml(note.payload?.recruiter_name || 'A recruiter')}</div>
              <div style="margin-top:8px;padding:10px;background:var(--surface-2);border-radius:6px;font-size:.95rem">
                ${escHtml(note.payload?.message || 'No message text')}
              </div>
            </div>
            <span class="role-badge role-badge--grey">${fmtDate(note.created_at)}</span>
          </div>
        </div>
      `;
    }
    const title = note.type === 'project_feature' ? 'Project updated'
      : note.type === 'recruiter_verified' ? 'Recruiter status updated'
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

// ── PROJECTS RENDER ───────────────────────────────────────
function renderProjects() {
  const grid = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');

  if (!myProjects.length) {
    grid.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

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

// ── SECTION NAVIGATION ────────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const sectionEl = document.getElementById(`section-${section}`);
  const navEl = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (sectionEl) sectionEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  if (section === 'activity') loadActivity();
  if (section === 'community') {
    loadCommunityGroups();
    renderCommunityCreators();
    renderCommunityProjects();
  }
  if (section === 'messages') {
    renderConversations();
    if (!currentConversation) renderEmptyConversation();
  }
}

// ── FORMS ─────────────────────────────────────────────────
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

  // FIX: community search now triggers a debounced server-side re-query
  // instead of just re-rendering the already-loaded local array.
  const communitySearchEl = document.getElementById('community-search-input');
  if (communitySearchEl) {
    communitySearchEl.addEventListener('input', () => {
      clearTimeout(communitySearchTimer);
      communitySearchTimer = setTimeout(async () => {
        const q = getCommunityQuery();
        const avail = document.getElementById('community-availability-filter')?.value || '';
        // Projects filter client-side (fast), creators re-query server-side
        renderCommunityProjects();
        renderCommunityCreators();
        await loadCommunityCreators(q, avail);
      }, 300);
    });
  }

  const avatarFile = document.getElementById('profile-avatar-file');
  if (avatarFile) {
    avatarFile.addEventListener('change', () => {
      const file = avatarFile.files?.[0];
      if (!file) return;
      updateAvatarPreview(URL.createObjectURL(file), currentProfile?.full_name || currentUser?.email);
    });
  }
}

async function compressAvatarFile(file) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
}

async function uploadAvatarIfNeeded() {
  const fileInput = document.getElementById('profile-avatar-file');
  const hiddenInput = document.getElementById('profile-avatar');
  const file = fileInput?.files?.[0];
  if (!file) return hiddenInput?.value.trim() || null;

  const compressed = await compressAvatarFile(file);
  const path = `${currentUser.id}/avatar-${Date.now()}.webp`;
  const { error } = await window.sb.storage
    .from('avatars')
    .upload(path, compressed || file, { contentType: 'image/webp', upsert: true });
  if (error) throw error;

  const { data } = window.sb.storage.from('avatars').getPublicUrl(path);
  const publicUrl = data?.publicUrl || null;
  if (hiddenInput) hiddenInput.value = publicUrl || '';
  updateAvatarPreview(publicUrl, currentProfile?.full_name || currentUser?.email);
  return publicUrl;
}

// ── SAVE PROFILE ──────────────────────────────────────────
// FIX: uses upsert instead of check-then-insert/update branch,
// so it always works whether or not a profile row already exists.
async function saveProfile(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  setBtnLoading(btn, true, 'Saving...');
  let avatarUrl = document.getElementById('profile-avatar')?.value.trim() || null;
  try {
    avatarUrl = await uploadAvatarIfNeeded();
  } catch (error) {
    setBtnLoading(btn, false);
    showToast('Avatar upload failed: ' + error.message, 'error');
    return;
  }

  const payload = {
    user_id: currentUser.id,
    handle: document.getElementById('profile-handle').value.trim() || null,
    age: parseInt(document.getElementById('profile-age').value, 10) || null,
    avatar_url: avatarUrl,
    github_username: document.getElementById('profile-github').value.trim() || null,
    headline: document.getElementById('profile-headline').value.trim(),
    bio: document.getElementById('profile-bio').value.trim(),
    location: document.getElementById('profile-location').value.trim(),
    visibility: document.getElementById('profile-visibility').value,
    availability: document.getElementById('profile-availability').value,
    skills: [...profileSkills]
  };

  const { error } = await window.sb
    .from('student_profiles')
    .upsert(payload, { onConflict: 'user_id' });

  setBtnLoading(btn, false);
  if (error) { showToast('Failed to save profile: ' + error.message, 'error'); return; }
  showToast('Profile saved!', 'success');
  await loadStudentProfile();
  await syncDiscoverability();
  showSection('overview');
}

// ── ADD PROJECT ───────────────────────────────────────────
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
  document.getElementById('add-proj-skills-wrap')?.querySelectorAll('.skill-tag').forEach(t => t.remove());
  await loadProjects();
  await loadStudentProfile();
  showSection('projects');
}

// ── EDIT PROJECT ──────────────────────────────────────────
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
  document.getElementById('edit-proj-skills-wrap')?.querySelectorAll('.skill-tag').forEach(t => t.remove());
  (project.tech_stack || []).forEach(s => editProjectSkillsInput?.addSkillTag(s));

  document.getElementById('edit-project-modal')?.classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-project-modal')?.classList.add('hidden');
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

// ── DELETE PROJECT ────────────────────────────────────────
async function deleteProject(id) {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  const { error } = await window.sb.rpc('delete_project_secure', { p_project_id: id });
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }
  showToast('Project deleted', 'warn');
  myProjects = myProjects.filter(project => project.id !== id);
  renderProjects();
  await loadProjects();
  await loadStudentProfile();
}

// ── PUBLIC PROFILE LINK ───────────────────────────────────
function openPublicProfile() {
  const handle = currentProfile?.handle;
  if (handle) {
    window.open(`/profile.html?handle=${encodeURIComponent(handle)}`, '_blank');
    return;
  }
  showToast('Set a public handle on your profile to preview it.', 'info');
}

// ── TRUST & SAFETY ────────────────────────────────────────
async function studentReportMessage(messageId, conversationId, reportedUserId) {
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

async function studentBlockUser(blockedUserId) {
  if (!confirm('Block this user? You will no longer receive messages from them.')) return;
  const { error } = await window.sb.from('blocked_users').insert({ blocker_id: currentUser.id, blocked_id: blockedUserId });
  if (error) { showToast('Failed to block user: ' + error.message, 'error'); return; }
  showToast('User blocked', 'warn');
  await loadConversations();
}

// ── HELPERS ───────────────────────────────────────────────
function getThreadInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
  stopConversationRefresh();
  if (studentRealtimeChannel) { studentRealtimeChannel.unsubscribe(); studentRealtimeChannel = null; }
  await Auth.signOut();
  window.location.href = '/index.html';
}

// ── GLOBAL EXPORTS ────────────────────────────────────────
// Compact profile lookup for the community search results.
function renderCommunityCreators() {
  const grid = document.getElementById('creator-directory-grid');
  const empty = document.getElementById('creator-directory-empty');
  if (!grid) return;
  const q = getCommunityQuery();
  const visibleCreators = communityCreators.filter(creator => {
    if (!q) return true;
    return [
      creator.handle,
      creator.creatorName,
      creator.creatorHeadline,
      creator.creatorLocation,
      creator.githubUsername,
      creator.userId,
      ...(creator.skills || []),
      ...(creator.projectTitles || [])
    ].some(value => String(value || '').toLowerCase().includes(q));
  });

  if (!visibleCreators.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = visibleCreators.map(creator => `
    <div class="creator-search-item animate-fade-up">
      <div class="student-avatar">${getThreadInitials(creator.creatorName)}</div>
      <div class="creator-search-item__body">
        <div class="creator-search-item__top">
          <strong>${escHtml(creator.handle ? '@' + creator.handle : creator.creatorName)}</strong>
          <span class="muted">${escHtml(creator.creatorName)}</span>
        </div>
        <div class="creator-search-item__bio">${escHtml(creator.creatorHeadline || 'Profile details can be added later.')}</div>
        <div class="muted">${escHtml(creator.userId)}${creator.creatorLocation ? ` · ${escHtml(creator.creatorLocation)}` : ''}</div>
      </div>
      <button class="btn btn--sm btn--primary" onclick="openCreatorConnection('${creator.userId}')">Message</button>
    </div>
  `).join('');
}

window.openCreatorComposer = openCreatorComposer;
window.openCreatorConnection = openCreatorConnection;
window.closeCreatorComposer = closeCreatorComposer;
window.openEditProject = openEditProject;
window.closeEditModal = closeEditModal;
window.saveEditProject = saveEditProject;
window.deleteProject = deleteProject;
window.openPublicProfile = openPublicProfile;
window.showSection = showSection;
window.logout = logout;
window.saveProfile = saveProfile;
window.addProject = addProject;
window.acceptInterview = acceptInterview;
window.rejectInterview = rejectInterview;
window.studentReportConversation = studentReportConversation;
window.studentBlockConversationPartner = studentBlockConversationPartner;
window.openConversation = openConversation;
window.createCommunityGroup = createCommunityGroup;
window.joinCommunityGroup = joinCommunityGroup;
window.openGroupChat = openGroupChat;
window.sendGroupMessage = sendGroupMessage;

// ── BOOT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initStudent);
window.addEventListener('beforeunload', stopConversationRefresh);
