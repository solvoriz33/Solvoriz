// ============================================================
// PROFILE.JS — Public builder profile page
// ============================================================

async function initPublicProfile() {
  const params = new URLSearchParams(window.location.search);
  const handle = params.get('handle');
  if (!handle) {
    renderNotFound('No profile handle specified.');
    return;
  }

  const { data, error } = await window.sb.rpc('get_public_profile', {
    p_handle: handle
  });

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
      <div class="empty-state__icon">⚠️</div>
      <div class="empty-state__title">Profile unavailable</div>
      <div class="empty-state__sub">${escHtml(message)}</div>
      <a href="/index.html" class="btn btn--primary" style="margin-top:16px">Back home</a>
    </div>
  `;
}

function renderProfile(profile) {
  const card = document.getElementById('profile-card');
  if (!card) return;
  const name = profile.full_name || 'Builder';
  const skills = (profile.skills || []).map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('');
  const visibleProjects = (profile.projects || [])
    .filter(project => project.visible && project.review_status !== 'flagged')
    .sort((a, b) => {
      if (Boolean(b.featured) !== Boolean(a.featured)) return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      return new Date(b.created_at) - new Date(a.created_at);
    });
  const projects = visibleProjects
    .map(p => `
    <div class="project-card animate-fade-up" style="margin-bottom:16px">
      ${p.image_url ? `<div class="project-card__image" style="background-image:url('${escHtml(p.image_url)}');"></div>` : ''}
      <div style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${escHtml(p.title)}</strong>
            ${p.featured ? '<span class="role-badge role-badge--recruiter">Featured project</span>' : ''}
          </div>
          <span class="role-badge role-badge--grey">${escHtml(p.project_type || 'Side Project')}</span>
        </div>
        <p class="project-card__desc">${escHtml(p.description || '')}</p>
        <div class="project-card__skills">${(p.tech_stack || []).map(sk => `<span class="skill-chip">${escHtml(sk)}</span>`).join('')}</div>
        <div class="project-card__links" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
          ${p.demo_link ? `<a class="project-link" href="${escHtml(p.demo_link)}" target="_blank" rel="noopener">Live demo</a>` : ''}
          ${p.github_link ? `<a class="project-link" href="${escHtml(p.github_link)}" target="_blank" rel="noopener">GitHub repo</a>` : ''}
        </div>
      </div>
    </div>
  `).join('');
  const headline = profile.headline || 'Project-first creator profile';
  const avatarStyle = profile.avatar_url
    ? `style="width:72px;height:72px;font-size:0;background-image:url('${escHtml(profile.avatar_url)}')"`
    : 'style="width:72px;height:72px;font-size:28px"';
  const visibleProjectCount = visibleProjects.length;
  const reviewCopy = profile.review_status === 'approved'
    ? 'Admin reviewed'
    : profile.review_status === 'flagged'
      ? 'Under review'
      : 'Pending review';
  const badges = [
    `<span class="role-badge role-badge--success">Discoverable</span>`,
    profile.featured ? `<span class="role-badge role-badge--recruiter">Featured</span>` : '',
    profile.review_status === 'approved' ? `<span class="role-badge role-badge--student">Verified profile</span>` : '',
    profile.availability ? `<span class="role-badge role-badge--grey">${escHtml(profile.availability)}</span>` : ''
  ].filter(Boolean).join('');

  card.innerHTML = `
    <div class="profile-public-shell">
      <div class="overview-profile-card animate-fade-up" style="margin-bottom:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div class="user-avatar-sm avatar-generated" ${avatarStyle}>${profile.avatar_url ? '' : getInitials(name)}</div>
            <div>
              <div class="muted">@${escHtml(profile.handle || 'profile')}</div>
              <h2 style="margin:4px 0 6px">${escHtml(name)}</h2>
              <div style="opacity:.9">${escHtml(headline)}</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">${badges}</div>
        </div>
        <div class="overview-profile-card__meta" style="margin-top:16px">
          <span>${profile.location ? escHtml(profile.location) : 'Location not shared'}</span>
          <span>${profile.age ? `Age ${profile.age}` : 'Age private'}</span>
          <span>${visibleProjectCount ? `${visibleProjectCount} visible projects` : 'No visible projects'}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:20px;align-items:start">
        <div>
          <div class="card" style="margin-bottom:18px">
            <h4>About</h4>
            <p class="muted">${escHtml(profile.bio || 'No bio provided yet.')}</p>
          </div>
          <div class="card" style="margin-bottom:18px">
            <h4>Projects</h4>
            ${projects || '<p class="muted">No visible projects yet.</p>'}
          </div>
        </div>

        <div style="display:grid;gap:18px">
          <div class="card">
            <div class="card__title">Trust snapshot</div>
            <div style="margin-top:14px;display:grid;gap:10px">
              <div class="notification-card">
                <strong>Search visibility</strong>
                <div class="muted notification-card__body">This builder is currently eligible to appear in recruiter discovery.</div>
              </div>
              <div class="notification-card">
                <strong>Review status</strong>
                <div class="muted notification-card__body">${escHtml(reviewCopy)}${profile.featured ? ' and currently featured by Solvoriz.' : '.'}</div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card__title">Builder identity</div>
            <div class="muted" style="margin-top:6px">Currently building, collaboration status, launch history, and contribution signals all live here.</div>
            <div class="progress-bar" style="margin-top:14px"><div class="progress-fill" style="width:100%"></div></div>
            <div class="muted" style="margin-top:10px">Live and searchable</div>
          </div>
          <div class="card">
            <h4>Collaboration</h4>
            <ul class="clean">
              <li>${profile.availability ? escHtml(profile.availability) : 'Availability not set yet'}</li>
              <li>${visibleProjectCount ? `${visibleProjectCount} shipped project signals` : 'Project history still forming'}</li>
              <li>Open to project-first discovery inside Solvoriz</li>
            </ul>
          </div>
          <div class="card">
            <h4>Skills</h4>
            <div class="skill-chips-row">${skills || '<span class="muted">No skills listed</span>'}</div>
          </div>
          ${profile.github_username ? `
            <div class="card">
              <h4>Links</h4>
              <div class="project-card__links" style="margin-top:10px">
                <a class="project-link" href="https://github.com/${escHtml(profile.github_username)}" target="_blank" rel="noopener">GitHub profile</a>
              </div>
            </div>
          ` : ''}
          <div class="card">
            <h4>Trust signals</h4>
            <ul class="clean">
              <li>Profile is visible in Solvoriz discovery</li>
              <li>${profile.review_status === 'approved' ? 'Reviewed by Solvoriz admin' : 'Pending manual profile review'}</li>
              <li>${profile.featured ? 'Currently featured by Solvoriz' : 'Not currently featured'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

window.addEventListener('DOMContentLoaded', initPublicProfile);
