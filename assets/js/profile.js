// ============================================================
// PROFILE.JS - Public builder profile page
// ============================================================

async function initPublicProfile() {
  const params = new URLSearchParams(window.location.search);
  const handle = params.get('handle');
  if (!handle) {
    renderNotFound('No profile handle specified.');
    return;
  }

  const { data, error } = await window.sb.rpc('get_public_profile', { p_handle: handle });
  if (error || !data) {
    renderNotFound('Profile not found or not visible.');
    return;
  }

  renderProfile(data);
}

function renderNotFound(message) {
  const card = document.getElementById('profile-card');
  if (!card) return;
  card.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__title">Profile unavailable</div>
      <div class="empty-state__sub">${escHtml(message)}</div>
      <a href="/index.html" class="btn btn--primary" style="margin-top:16px">Back home</a>
    </div>
  `;
}

function renderProfile(profile) {
  const card = document.getElementById('profile-card');
  if (!card) return;

  const name = profile.display_name || profile.full_name || 'Unknown Builder';
  const username = profile.username || profile.handle || 'builder';
  const visibleProjects = (profile.projects || [])
    .filter(project => project.visible && project.review_status !== 'flagged')
    .sort((a, b) => (Number(Boolean(b.featured)) - Number(Boolean(a.featured))) || (new Date(b.created_at) - new Date(a.created_at)));
  const launches = visibleProjects.filter(project => ['Launch', 'Startup', 'Open Source'].includes(project.project_type || ''));
  const skills = (profile.skills || []).map(skill => `<span class="skill-chip">${escHtml(skill)}</span>`).join('');
  const avatarStyle = profile.avatar_url ? `style="background-image:url('${escHtml(profile.avatar_url)}')"` : '';

  const projectCards = visibleProjects.map(project => `
    <article class="project-card animate-fade-up">
      ${project.image_url ? `<div class="project-card__image" style="background-image:url('${escHtml(project.image_url)}');"></div>` : ''}
      <div class="project-card__header">
        <div>
          <h3 class="project-card__title">${escHtml(project.title)}</h3>
          <div class="project-card__meta">${escHtml(project.project_type || 'Project')} &middot; ${fmtDate(project.created_at)}</div>
        </div>
        ${project.featured ? '<span class="role-badge role-badge--student">Pinned</span>' : ''}
      </div>
      <p class="project-card__desc">${escHtml(project.description || '')}</p>
      <div class="project-card__skills">${(project.tech_stack || []).map(skill => `<span class="skill-chip">${escHtml(skill)}</span>`).join('')}</div>
      <div class="project-card__links">
        ${project.demo_link ? `<a class="project-link" href="${escHtml(project.demo_link)}" target="_blank" rel="noopener">Live demo</a>` : ''}
        ${project.github_link ? `<a class="project-link" href="${escHtml(project.github_link)}" target="_blank" rel="noopener">GitHub</a>` : ''}
      </div>
    </article>
  `).join('');

  const timeline = (profile.timeline || visibleProjects).map(item => `
    <div class="profile-timeline__item">
      <span></span>
      <div><strong>${escHtml(item.title)}</strong><p>Shipped ${fmtDate(item.created_at)}</p></div>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="profile-public-shell profile-elite">
      <section class="profile-hero-card">
        <div class="profile-hero-card__banner"></div>
        <div class="profile-hero-card__body">
          <div class="user-avatar-sm avatar-generated avatar-xl" ${avatarStyle}>${profile.avatar_url ? '' : getInitials(name)}</div>
          <div class="profile-hero-card__main">
            <div class="muted">@${escHtml(username)}</div>
            <h1>${escHtml(name)}</h1>
            <p>${escHtml(profile.headline || 'Builder on Solvoriz')}</p>
            <div class="profile-hero-card__badges">
              ${profile.review_status === 'approved' ? '<span class="role-badge role-badge--student">Verified</span>' : '<span class="role-badge role-badge--grey">Builder</span>'}
              ${profile.featured ? '<span class="role-badge role-badge--recruiter">Featured</span>' : ''}
              ${profile.availability ? `<span class="role-badge role-badge--success">${escHtml(profile.availability)}</span>` : ''}
            </div>
          </div>
        </div>
      </section>

      <section class="profile-stats-grid">
        <div><strong>${visibleProjects.length}</strong><span>Projects</span></div>
        <div><strong>${launches.length}</strong><span>Launches</span></div>
        <div><strong>${profile.followers || 0}</strong><span>Followers</span></div>
        <div><strong>${(profile.skills || []).length}</strong><span>Skills</span></div>
      </section>

      <div class="profile-tabs" role="tablist">
        <button class="active" type="button" onclick="showPublicProfileTab('work')">Work</button>
        <button type="button" onclick="showPublicProfileTab('timeline')">Timeline</button>
        <button type="button" onclick="showPublicProfileTab('about')">About</button>
      </div>

      <section class="profile-tab-panel active" id="profile-tab-work">
        <div class="projects-grid">${projectCards || '<div class="empty-state"><div class="empty-state__title">No shipped work yet</div><div class="empty-state__sub">Launches will appear here automatically.</div></div>'}</div>
      </section>
      <section class="profile-tab-panel" id="profile-tab-timeline">
        <div class="card profile-timeline">${timeline || '<p class="muted">No launch timeline yet.</p>'}</div>
      </section>
      <section class="profile-tab-panel" id="profile-tab-about">
        <div class="identity-layout">
          <div class="card"><h4>About</h4><p class="muted">${escHtml(profile.bio || 'No bio provided yet.')}</p></div>
          <div class="card"><h4>Stack and skills</h4><div class="skill-chips-row">${skills || '<span class="muted">No skills listed</span>'}</div>${profile.github_username ? `<div class="project-card__links" style="margin-top:14px"><a class="project-link" href="https://github.com/${escHtml(profile.github_username)}" target="_blank" rel="noopener">GitHub</a></div>` : ''}</div>
        </div>
      </section>
    </div>
  `;
}

function showPublicProfileTab(tab) {
  document.querySelectorAll('.profile-tabs button').forEach(button => {
    button.classList.toggle('active', button.getAttribute('onclick') === `showPublicProfileTab('${tab}')`);
  });
  document.querySelectorAll('.profile-tab-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`profile-tab-${tab}`)?.classList.add('active');
}

function getInitials(name) {
  return (name || '?').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
}

window.showPublicProfileTab = showPublicProfileTab;
window.addEventListener('DOMContentLoaded', initPublicProfile);
