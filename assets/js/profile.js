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

  const session = await Auth.getSession();
  if (!session) {
    window.location.href = '/auth.html';
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
  const email = profile.users?.email || '';
  const skills = (profile.skills || []).map(s => `<span class="skill-chip">${escHtml(s)}</span>`).join('');
  const projects = (profile.projects || []).map(p => `
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

  card.innerHTML = `
    <div class="profile-header" style="display:grid;gap:18px">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div class="user-avatar-sm" style="width:72px;height:72px;font-size:28px">${getInitials(name)}</div>
        <div>
          <h2>${escHtml(name)}</h2>
          <div class="muted">@${escHtml(profile.handle || 'profile')}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span class="role-badge role-badge--success">${escHtml(profile.visibility === 'hidden' ? 'Hidden' : 'Public')}</span>
        <span class="role-badge role-badge--grey">${escHtml(profile.availability || 'Not set')}</span>
      </div>
    </div>
    <div style="display:grid;gap:18px;">
      <div>
        <h4>About</h4>
        <p class="muted">${escHtml(profile.bio || 'No bio provided yet.')}</p>
      </div>
      <div>
        <h4>Skills</h4>
        <div class="skill-chips-row">${skills || '<span class="muted">No skills listed</span>'}</div>
      </div>
      <div>
        <h4>Projects</h4>
        ${projects || '<p class="muted">No visible projects yet.</p>'}
      </div>
      <div style="padding:18px;background:var(--surface-2);border-radius:16px">
        <strong>Email</strong>
        <p>${escHtml(email)}</p>
      </div>
    </div>
  `;
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

window.addEventListener('DOMContentLoaded', initPublicProfile);
