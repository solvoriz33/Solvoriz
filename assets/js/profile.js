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

  const { data, error } = await window.sb
    .from('student_profiles')
    .select(`*, users:user_id(id, full_name, email), projects:user_id(*)`)
    .eq('handle', handle)
    .single();

  if (error || !data) {
    renderNotFound('Profile not found or not visible.');
    return;
  }

  if (data.visibility === 'hidden' || !data.discoverable || data.review_status === 'flagged') {
    renderNotFound('This profile is not currently public.');
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
  const name = profile.users?.full_name || 'Builder';
  const skills = (profile.skills || []).map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('');
  const projects = (profile.projects || [])
    .filter(project => project.visible && project.review_status !== 'flagged')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(p => `
    <div class="project-card animate-fade-up" style="margin-bottom:16px">
      ${p.image_url ? `<div class="project-card__image" style="background-image:url('${escHtml(p.image_url)}');"></div>` : ''}
      <div style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <strong>${escHtml(p.title)}</strong>
          <span class="role-badge role-badge--grey">${escHtml(p.project_type || 'Side Project')}</span>
        </div>
        <p class="project-card__desc">${escHtml(p.description || '')}</p>
        <div class="project-card__skills">${(p.tech_stack || []).map(sk => `<span class="skill-chip">${escHtml(sk)}</span>`).join('')}</div>
        <div class="project-card__links" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
          ${p.demo_link ? `<a class="project-link" href="${escHtml(p.demo_link)}" target="_blank" rel="noopener">🔗 Demo</a>` : ''}
          ${p.github_link ? `<a class="project-link" href="${escHtml(p.github_link)}" target="_blank" rel="noopener">⌥ GitHub</a>` : ''}
        </div>
      </div>
    </div>
  `).join('');
  const headline = profile.headline || 'Project-first creator profile';
  const score = calculateProfileStrength(profile, profile.projects || []);
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
            <div class="user-avatar-sm" style="width:72px;height:72px;font-size:28px">${getInitials(name)}</div>
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
          <span>${projects ? `${(profile.projects || []).filter(project => project.visible && project.review_status !== 'flagged').length} visible projects` : 'No visible projects'}</span>
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
            <div class="card__title">Profile strength</div>
            <div class="muted" style="margin-top:6px">A stronger public profile earns more recruiter trust.</div>
            <div class="progress-bar" style="margin-top:14px"><div class="progress-fill" style="width:${score}%"></div></div>
            <div class="muted" style="margin-top:10px">${score}/100 strength score</div>
          </div>
          <div class="card">
            <h4>Skills</h4>
            <div class="skill-chips-row">${skills || '<span class="muted">No skills listed</span>'}</div>
          </div>
          <div class="card">
            <h4>Trust signals</h4>
            <ul class="clean">
              <li>${profile.discoverable ? 'Profile is visible in recruiter search' : 'Profile is not discoverable yet'}</li>
              <li>${profile.review_status === 'approved' ? 'Reviewed by Solvoriz admin' : 'Pending manual profile review'}</li>
              <li>${profile.featured ? 'Currently featured by Solvoriz' : 'Not currently featured'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

function calculateProfileStrength(profile, projects) {
  let score = 20;
  if (profile.headline) score += 20;
  if (profile.bio) score += 15;
  if (profile.location) score += 10;
  if (profile.avatar_url) score += 5;
  if (profile.github_username) score += 5;
  score += Math.min((profile.skills || []).length * 3, 20);
  score += Math.min((projects || []).filter(project => project.visible && project.review_status !== 'flagged').length * 8, 25);
  return Math.min(score, 100);
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

window.addEventListener('DOMContentLoaded', initPublicProfile);
