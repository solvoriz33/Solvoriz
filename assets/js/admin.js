// ============================================================
// ADMIN.JS - Admin panel logic
// ============================================================

let currentAdmin = null;
let allUsers = [];
let allProjects = [];

function isPendingRecruiter(user) {
  return user?.requested_role === 'recruiter' && user?.role !== 'recruiter';
}

async function initAdmin() {
  const result = await requireAuth('admin');
  if (!result) return;

  currentAdmin = result.profile;
  document.getElementById('admin-name').textContent = currentAdmin.full_name || 'Admin';

  await Promise.all([loadStats(), loadUsers(), loadAllProjects(), loadModerationQueue()]);
  showSection('overview');

  document.addEventListener('click', event => {
    if (event.target?.id === 'admin-project-modal') closeAdminProjectModal();
  });
}

async function loadStats() {
  const [usersRes, studentsRes, recruitersRes, projectsRes, discoverableRes, pendingRecruitersRes, moderationProjectsRes, moderationProfilesRes, featuredProfilesRes] = await Promise.all([
    window.sb.from('users').select('id', { count: 'exact', head: true }),
    window.sb.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    window.sb.from('users').select('id', { count: 'exact', head: true }).eq('role', 'recruiter'),
    window.sb.from('projects').select('id', { count: 'exact', head: true }),
    window.sb.from('student_profiles').select('id', { count: 'exact', head: true }).eq('discoverable', true),
    window.sb.from('users').select('id', { count: 'exact', head: true }).eq('requested_role', 'recruiter').neq('role', 'recruiter'),
    window.sb.from('projects').select('id', { count: 'exact', head: true }).in('review_status', ['under review', 'flagged']),
    window.sb.from('student_profiles').select('id', { count: 'exact', head: true }).neq('review_status', 'approved'),
    window.sb.from('student_profiles').select('id', { count: 'exact', head: true }).eq('featured', true)
  ]);

  document.getElementById('stat-total-users').textContent = usersRes.count || 0;
  document.getElementById('stat-students').textContent = studentsRes.count || 0;
  document.getElementById('stat-recruiters').textContent = recruitersRes.count || 0;
  document.getElementById('stat-projects').textContent = projectsRes.count || 0;
  document.getElementById('stat-discoverable').textContent = discoverableRes.count || 0;
  document.getElementById('stat-pending-recruiters').textContent = pendingRecruitersRes.count || 0;
  document.getElementById('stat-moderation-items').textContent = (moderationProjectsRes.count || 0) + (moderationProfilesRes.count || 0);
  document.getElementById('stat-featured-profiles').textContent = featuredProfilesRes.count || 0;

  renderOpsSnapshot({
    discoverable: discoverableRes.count || 0,
    pendingRecruiters: pendingRecruitersRes.count || 0,
    moderationItems: (moderationProjectsRes.count || 0) + (moderationProfilesRes.count || 0),
    featuredProfiles: featuredProfilesRes.count || 0,
    totalStudents: studentsRes.count || 0,
    totalProjects: projectsRes.count || 0
  });
}

function renderOpsSnapshot(stats) {
  const container = document.getElementById('ops-snapshot');
  if (!container) return;

  const discoverableRate = stats.totalStudents ? Math.round((stats.discoverable / stats.totalStudents) * 100) : 0;
  container.innerHTML = `
    <div class="notification-card">
      <strong>Discoverability health</strong>
      <div class="muted notification-card__body">${stats.discoverable} of ${stats.totalStudents} students are currently discoverable (${discoverableRate}%).</div>
    </div>
    <div class="notification-card">
      <strong>Trust and approval queue</strong>
      <div class="muted notification-card__body">${stats.pendingRecruiters} recruiter accounts still need admin approval.</div>
    </div>
    <div class="notification-card">
      <strong>Moderation workload</strong>
      <div class="muted notification-card__body">${stats.moderationItems} items are waiting for review across profiles and projects.</div>
    </div>
    <div class="notification-card">
      <strong>Editorial curation</strong>
      <div class="muted notification-card__body">${stats.featuredProfiles} student profiles are currently featured, with ${stats.totalProjects} total projects live on the platform.</div>
    </div>
  `;
}

async function loadUsers() {
  const { data, error } = await window.sb
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load users', 'error');
    return;
  }

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

  tbody.innerHTML = users.map(user => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-cell__avatar">${getInitials(user.full_name || user.email)}</div>
          <div>
            <div class="user-cell__name">${escHtml(user.full_name || '-')}</div>
            <div class="user-cell__email">${escHtml(user.email)}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="role-badge role-badge--${user.role}">${escHtml(user.role)}</span>
        ${(user.role === 'recruiter' || isPendingRecruiter(user)) ? `<span class="role-badge role-badge--${user.verified_recruiter ? 'success' : 'grey'}" style="margin-left:8px">${user.verified_recruiter ? 'Verified' : 'Pending'}</span>` : ''}
      </td>
      <td>${fmtDate(user.created_at)}</td>
      <td>
        ${user.id === currentAdmin.id ? '<span class="muted">You</span>' : `
          ${(user.role === 'recruiter' || isPendingRecruiter(user)) ? `<button class="btn btn--sm btn--outline" onclick="toggleRecruiterVerification('${user.id}', ${user.verified_recruiter}, ${isPendingRecruiter(user)})">${user.verified_recruiter ? 'Revoke' : 'Approve'}</button>` : ''}
        `}
      </td>
    </tr>
  `).join('');
}

function getInitials(str) {
  return (str || '?').split(/[\s@]/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
}

function searchUsers(query) {
  if (!query.trim()) {
    renderUsersTable(allUsers);
    return;
  }

  const filtered = allUsers.filter(user =>
    user.email?.toLowerCase().includes(query.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(query.toLowerCase())
  );
  renderUsersTable(filtered);
}

function filterByRole(role) {
  if (!role) {
    renderUsersTable(allUsers);
    return;
  }

  renderUsersTable(allUsers.filter(user => user.role === role));
}

async function toggleRecruiterVerification(userId, currentValue, isPending = false) {
  const nextValue = !Boolean(currentValue);
  const rpcName = isPending ? 'admin_promote_to_recruiter' : 'admin_set_recruiter_verification';
  const { error } = await window.sb.rpc(rpcName, {
    p_target_user_id: userId,
    p_verified: nextValue
  });

  if (error) {
    showToast('Failed to update recruiter verification: ' + error.message, 'error');
    return;
  }

  await createNotification(userId, 'recruiter_verified', {
    detail: nextValue ? 'Your recruiter account has been verified.' : 'Your recruiter verification has been revoked.'
  });

  showToast(nextValue ? 'Recruiter verified' : 'Recruiter verification revoked', 'success');
  allUsers = allUsers.map(user => user.id === userId ? {
    ...user,
    role: 'recruiter',
    requested_role: 'recruiter',
    verified_recruiter: nextValue
  } : user);
  renderUsersTable(allUsers);
  await Promise.all([loadStats(), loadModerationQueue()]);
}

async function loadAllProjects() {
  const { data, error } = await window.sb
    .from('projects')
    .select(`*, users:user_id (full_name, email, role)`)
    .order('created_at', { ascending: false });

  if (error) return;
  allProjects = data || [];
  renderProjectsTable(allProjects);
}

async function loadModerationQueue() {
  const [recruitersRes, projectsRes, profilesRes, reportsRes] = await Promise.all([
    window.sb.from('users').select('*').eq('requested_role', 'recruiter').neq('role', 'recruiter'),
    window.sb.from('projects')
      .select(`*, users:user_id (full_name, email)`)
      .in('review_status', ['under review', 'flagged'])
      .order('created_at', { ascending: false }),
    window.sb.from('student_profiles')
      .select(`*, users:user_id (full_name, email)`)
      .order('updated_at', { ascending: false })
      .limit(40),
    window.sb.from('moderation_reports')
      .select(`*, reporter:reporter_id (full_name, email), reported:reported_user_id (full_name, email)`)
      .order('created_at', { ascending: false })
      .limit(60)
  ]);

  const recruiters = recruitersRes.data || [];
  const queuedProjects = projectsRes.data || [];
  const profiles = profilesRes.data || [];
  const reports = reportsRes.data || [];

  renderModerationRecruiters(recruiters);
  renderModerationProjects(queuedProjects);
  renderModerationProfiles(profiles);
  renderModerationReports(reports);
  renderOverviewQueues(recruiters, queuedProjects, profiles);
}

function renderOverviewQueues(recruiters, projects, profiles) {
  const approvals = document.getElementById('overview-approvals');
  const discoverability = document.getElementById('overview-discoverability');

  if (approvals) {
    const pendingProfiles = profiles.filter(profile => profile.review_status !== 'approved').slice(0, 3);
    approvals.innerHTML = `
      <div class="notification-card">
        <strong>Recruiter approvals</strong>
        <div class="muted notification-card__body">${recruiters.length} recruiter account${recruiters.length === 1 ? '' : 's'} waiting for verification.</div>
      </div>
      <div class="notification-card">
        <strong>Project moderation</strong>
        <div class="muted notification-card__body">${projects.length} project${projects.length === 1 ? '' : 's'} currently flagged or under review.</div>
      </div>
      <div class="notification-card">
        <strong>Profiles to review next</strong>
        <div class="muted notification-card__body">${pendingProfiles.length ? pendingProfiles.map(profile => profile.users?.full_name || profile.users?.email || 'Student').join(', ') : 'No student profiles currently waiting for approval.'}</div>
      </div>
    `;
  }

  if (discoverability) {
    const hiddenProfiles = profiles.filter(profile => profile.visibility === 'hidden').length;
    const pendingReview = profiles.filter(profile => profile.review_status !== 'approved').length;
    const notDiscoverable = profiles.filter(profile => !profile.discoverable).length;
    const featuredProfiles = profiles.filter(profile => profile.featured).length;
    discoverability.innerHTML = `
      <div class="notification-card">
        <strong>Hidden profiles</strong>
        <div class="muted notification-card__body">${hiddenProfiles} profiles are set to hidden and will not surface to recruiters.</div>
      </div>
      <div class="notification-card">
        <strong>Search readiness</strong>
        <div class="muted notification-card__body">${notDiscoverable} profiles are still not discoverable, usually because the profile or project stack is incomplete.</div>
      </div>
      <div class="notification-card">
        <strong>Review + editorial</strong>
        <div class="muted notification-card__body">${pendingReview} profiles need review, while ${featuredProfiles} are already featured.</div>
      </div>
    `;
  }
}

function renderModerationRecruiters(recruiters) {
  const container = document.getElementById('moderation-recruiters');
  const empty = document.getElementById('moderation-recruiters-empty');
  if (!container) return;

  if (!recruiters.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.innerHTML = recruiters.map(user => `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <strong>${escHtml(user.full_name || user.email)}</strong>
          <div class="muted">${escHtml(user.email)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn--primary btn--sm" onclick="toggleRecruiterVerification('${user.id}', ${user.verified_recruiter}, true)">Approve recruiter</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderModerationProjects(projects) {
  const container = document.getElementById('moderation-projects');
  const empty = document.getElementById('moderation-projects-empty');
  if (!container) return;

  if (!projects.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.innerHTML = projects.map(project => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <strong>${escHtml(project.title)}</strong>
          <div class="muted">${escHtml(project.users?.full_name || project.users?.email || 'Unknown student')}</div>
          <div class="muted">Status: ${escHtml(project.review_status)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--primary btn--sm" onclick="setProjectReviewStatus('${project.id}','active')">Approve</button>
          <button class="btn btn--outline btn--sm" onclick="setProjectReviewStatus('${project.id}','flagged')">Flag</button>
          <button class="btn btn--outline btn--sm" onclick="toggleFeature('${project.id}')">${project.featured ? 'Unfeature' : 'Feature'}</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderModerationProfiles(profiles) {
  const container = document.getElementById('moderation-profiles');
  const empty = document.getElementById('moderation-profiles-empty');
  if (!container) return;

  if (!profiles.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.innerHTML = profiles.map(profile => `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <strong>${escHtml(profile.users?.full_name || profile.users?.email || 'Student')}</strong>
          <div class="muted">${escHtml(profile.users?.email || '')}</div>
          <div class="muted">Status: ${escHtml(profile.review_status)}</div>
          <div class="muted">Visibility: ${escHtml(profile.visibility || 'public')} · ${profile.discoverable ? 'Discoverable' : 'Not discoverable'}</div>
          ${profile.featured ? '<span class="role-badge role-badge--success">Featured</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--primary btn--sm" onclick="setProfileReviewStatus('${profile.id}','approved')">Approve</button>
          <button class="btn btn--outline btn--sm" onclick="setProfileReviewStatus('${profile.id}','flagged')">Flag</button>
          <button class="btn btn--outline btn--sm" onclick="toggleProfileFeatured('${profile.id}', ${profile.featured})">${profile.featured ? 'Unfeature' : 'Feature'}</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderModerationReports(reports) {
  const container = document.getElementById('moderation-reports');
  if (!container) return;

  if (!reports.length) {
    container.innerHTML = '<div class="muted">No recent reports</div>';
    return;
  }

  container.innerHTML = reports.map(report => {
    const reporterName = report.reporter?.full_name || report.reporter?.email || 'Reporter';
    const reportedName = report.reported?.full_name || report.reported?.email || 'Reported user';
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <strong>${escHtml(reporterName)} reported ${escHtml(reportedName)}</strong>
            <div class="muted">Reason: ${escHtml(report.reason_category || 'Unknown')}</div>
            <div class="muted">Detail: ${escHtml(report.reason_detail || '')}</div>
            <div class="muted">Created: ${fmtDate(report.created_at)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn--primary btn--sm" onclick="reviewReport('${report.id}','resolve')">Resolve</button>
            <button class="btn btn--outline btn--sm" onclick="reviewReport('${report.id}','dismiss')">Dismiss</button>
            <button class="btn btn--danger btn--sm" onclick="reviewReport('${report.id}','suspend')">Suspend User</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function reviewReport(reportId, action) {
  if (!reportId) return;

  const note = prompt('Optional review note (internal):') || '';
  const status = action === 'resolve' ? 'resolved' : action === 'dismiss' ? 'dismissed' : 'in_review';
  const { error: updateErr } = await window.sb
    .from('moderation_reports')
    .update({ status, reviewed_by: currentAdmin.id, review_notes: note })
    .eq('id', reportId);

  if (updateErr) {
    showToast('Failed to update report: ' + updateErr.message, 'error');
    return;
  }

  if (action === 'suspend') {
    const days = parseInt(prompt('Suspend for how many days? (e.g. 7)'), 10) || 7;
    const until = new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
    const { data: reportRow } = await window.sb
      .from('moderation_reports')
      .select('reported_user_id')
      .eq('id', reportId)
      .single();

    if (reportRow?.reported_user_id) {
      const { error: suspendErr } = await window.sb.rpc('admin_suspend_user', {
        p_target_user_id: reportRow.reported_user_id,
        p_suspended_until: until,
        p_reason: note || 'Suspended from moderation review'
      });
      if (suspendErr) {
        showToast('Failed to suspend user: ' + suspendErr.message, 'error');
      } else {
        showToast('User suspended', 'warn');
      }
    }
  }

  const { error: auditErr } = await window.sb.from('moderation_actions').insert([{
    admin_id: currentAdmin.id,
    action_type: action === 'suspend' ? 'user_suspended' : 'report_reviewed',
    target_type: 'report',
    target_id: reportId,
    details: { action, note }
  }]);
  if (auditErr) console.warn('Failed to log moderation action', auditErr.message);

  await Promise.all([loadModerationQueue(), loadStats()]);
}

async function setProjectReviewStatus(id, status) {
  const { error } = await window.sb.from('projects').update({ review_status: status }).eq('id', id);
  if (error) {
    showToast('Failed to update project review status: ' + error.message, 'error');
    return;
  }

  showToast('Project review status updated', 'success');
  await Promise.all([loadModerationQueue(), loadStats()]);
}

async function setProfileReviewStatus(id, status) {
  const { error } = await window.sb.from('student_profiles').update({ review_status: status }).eq('id', id);
  if (error) {
    showToast('Failed to update profile review status: ' + error.message, 'error');
    return;
  }

  showToast('Profile review status updated', 'success');
  await Promise.all([loadModerationQueue(), loadStats()]);
}

async function toggleProfileFeatured(id, currentValue) {
  const nextValue = !currentValue;
  const { error } = await window.sb.from('student_profiles').update({ featured: nextValue }).eq('id', id);
  if (error) {
    showToast('Unable to update featured status: ' + error.message, 'error');
    return;
  }

  showToast(nextValue ? 'Profile featured' : 'Profile unfeatured', 'success');
  await Promise.all([loadModerationQueue(), loadStats()]);
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-tbody');
  if (!tbody) return;

  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No projects</td></tr>';
    return;
  }

  tbody.innerHTML = projects.map(project => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <strong>${escHtml(project.title)}</strong>
          ${project.featured ? '<span class="role-badge role-badge--success">Featured</span>' : ''}
          <span class="role-badge role-badge--grey">${escHtml(project.project_type || 'Side Project')}</span>
          ${project.visible ? '' : '<span class="role-badge role-badge--danger">Hidden</span>'}
        </div>
      </td>
      <td>${escHtml(project.users?.full_name || project.users?.email || '-')}</td>
      <td>
        <div class="skill-chips-row skill-chips-row--sm">
          ${(project.tech_stack || []).slice(0, 4).map(skill => `<span class="skill-chip skill-chip--sm">${escHtml(skill)}</span>`).join('')}
        </div>
      </td>
      <td>${fmtDate(project.created_at)}</td>
      <td>
        <button class="btn btn--sm btn--ghost" onclick="openProject('${project.id}')">View</button>
        <button class="btn btn--sm btn--outline" onclick="toggleFeature('${project.id}')">${project.featured ? 'Unfeature' : 'Feature'}</button>
        <button class="btn btn--sm btn--danger" onclick="deleteProject('${project.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openProject(id) {
  const project = allProjects.find(item => item.id === id);
  if (!project) return;

  const modal = document.getElementById('admin-project-modal');
  const content = document.getElementById('admin-project-modal-content');
  if (!modal || !content) return;

  content.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <h2>${escHtml(project.title)}</h2>
        <p class="muted">${escHtml(project.users?.full_name || project.users?.email || 'Unknown student')}</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn--primary btn--sm" onclick="toggleFeature('${project.id}')">${project.featured ? 'Unfeature' : 'Feature'}</button>
        <button class="btn btn--danger btn--sm" onclick="deleteProject('${project.id}')">Delete</button>
      </div>
    </div>
    ${project.image_url ? `<div class="project-card__image" style="background-image:url('${escHtml(project.image_url)}');margin-top:16px;height:180px;background-size:cover;background-position:center;border-radius:12px"></div>` : ''}
    <div style="margin-top:18px">
      <p>${escHtml(project.description || 'No description provided.')}</p>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
      <span class="role-badge role-badge--${project.visible ? 'success' : 'danger'}">${project.visible ? 'Visible' : 'Hidden'}</span>
      <span class="role-badge role-badge--grey">${escHtml(project.project_type || 'Side Project')}</span>
    </div>
    <div class="project-card__skills" style="margin-top:16px">
      ${(project.tech_stack || []).map(skill => `<span class="skill-chip">${escHtml(skill)}</span>`).join('')}
    </div>
    <div class="project-card__links" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      ${project.demo_link ? `<a class="project-link" href="${escHtml(project.demo_link)}" target="_blank" rel="noopener">Live Demo</a>` : ''}
      ${project.github_link ? `<a class="project-link" href="${escHtml(project.github_link)}" target="_blank" rel="noopener">GitHub</a>` : ''}
    </div>
    <div style="margin-top:18px;color:var(--ink-3);font-size:.95rem;display:grid;gap:6px">
      <div><strong>Added:</strong> ${fmtDate(project.created_at)}</div>
      <div><strong>Student email:</strong> ${escHtml(project.users?.email || '-')}</div>
      <div><strong>Student role:</strong> ${escHtml(project.users?.role || '-')}</div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeAdminProjectModal() {
  document.getElementById('admin-project-modal')?.classList.add('hidden');
}

async function toggleFeature(id) {
  const project = allProjects.find(item => item.id === id);
  if (!project) return;

  const nextValue = !project.featured;
  const { error } = await window.sb.from('projects').update({ featured: nextValue }).eq('id', id);
  if (error) {
    showToast('Unable to update featured status: ' + error.message, 'error');
    return;
  }

  project.featured = nextValue;
  if (project.user_id) {
    await createNotification(project.user_id, 'project_feature', {
      project_id: project.id,
      title: project.title,
      featured: nextValue,
      detail: nextValue ? 'Your project has been featured by an admin.' : 'Your project has been removed from featured projects.'
    });
  }

  showToast(nextValue ? 'Project featured' : 'Project unfeatured', 'success');
  renderProjectsTable(allProjects);
  await Promise.all([loadModerationQueue(), loadStats()]);
  if (!document.getElementById('admin-project-modal')?.classList.contains('hidden')) {
    openProject(id);
  }
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;

  const { error } = await window.sb.from('projects').delete().eq('id', id);
  if (error) {
    showToast('Failed: ' + error.message, 'error');
    return;
  }

  closeAdminProjectModal();
  showToast('Project deleted', 'warn');
  allProjects = allProjects.filter(project => project.id !== id);
  renderProjectsTable(allProjects);
  await Promise.all([loadModerationQueue(), loadStats()]);
}

function showSection(section) {
  document.querySelectorAll('.dash-section').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
}

async function logout() {
  await Auth.signOut();
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', initAdmin);
