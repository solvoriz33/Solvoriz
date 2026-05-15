// ============================================================
// APP.JS — Shared utilities, toast, routing helpers
// ============================================================

// ── Toast Notifications ──────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${icons[type] || icons.info}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);

  // Auto-remove
  setTimeout(() => {
    toast.classList.add('toast--out');
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

// ── HTML Escape ──────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Format date ──────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Set button loading state ─────────────────────────────
function setBtnLoading(btn, loading, label = '') {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${label || 'Loading...'}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || label;
    btn.disabled = false;
  }
}

// ── Skill Tag system ─────────────────────────────────────
const SKILL_POOL = [
  'JavaScript','TypeScript','Python','Rust','Go','Java','C++','C#','Swift','Kotlin',
  'React','Vue','Svelte','Angular','Next.js','Nuxt','Astro','SvelteKit',
  'Node.js','Express','FastAPI','Django','Flask','Spring Boot','Laravel',
  'PostgreSQL','MySQL','MongoDB','Redis','Supabase','Firebase','PlanetScale',
  'HTML','CSS','Tailwind CSS','SASS','Three.js','WebGL','D3.js',
  'Docker','Kubernetes','AWS','GCP','Azure','Vercel','Netlify','Cloudflare',
  'Machine Learning','PyTorch','TensorFlow','OpenCV','NLP','LLMs','RAG',
  'Figma','UI/UX','Design Systems','Framer','Webflow',
  'GraphQL','REST API','WebSockets','gRPC','Kafka','RabbitMQ',
  'Git','GitHub Actions','CI/CD','Linux','Bash','Terraform',
  'Solidity','Web3','Ethers.js','React Native','Flutter','Expo',
  'Unity','Unreal Engine','Blender','Arduino','Raspberry Pi'
];

function initSkillInput(config) {
  // config: { wrapId, inputId, suggestId, arr, max, onChange }
  const { wrapId, inputId, suggestId, arr, max, onChange } = config;

  const wrap = document.getElementById(wrapId);
  const input = document.getElementById(inputId);
  const suggest = document.getElementById(suggestId);
  if (!wrap || !input) return;

  function renderSuggestions(val) {
    if (!val.trim()) { suggest?.classList.add('hidden'); return; }
    const matches = SKILL_POOL.filter(s =>
      s.toLowerCase().includes(val.toLowerCase()) && !arr.includes(s)
    ).slice(0, 7);
    if (!suggest) return;
    if (!matches.length) { suggest.classList.add('hidden'); return; }
    suggest.innerHTML = matches.map(s =>
      `<div class="skill-suggest__item" data-skill="${escHtml(s)}">${escHtml(s)}</div>`
    ).join('');
    suggest.classList.remove('hidden');
    suggest.querySelectorAll('.skill-suggest__item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        addSkillTag(item.dataset.skill);
        input.value = '';
        suggest.classList.add('hidden');
        input.focus();
      });
    });
  }

  function addSkillTag(skill) {
    skill = skill.trim();
    if (!skill || arr.includes(skill) || arr.length >= max) return;
    arr.push(skill);
    const tag = document.createElement('span');
    tag.className = 'skill-tag';
    tag.innerHTML = `${escHtml(skill)}<button class="skill-tag__remove" data-skill="${escHtml(skill)}">×</button>`;
    tag.querySelector('.skill-tag__remove').addEventListener('click', () => {
      const idx = arr.indexOf(skill);
      if (idx > -1) arr.splice(idx, 1);
      tag.remove();
      if (onChange) onChange();
    });
    wrap.insertBefore(tag, input);
    if (onChange) onChange();
  }

  input.addEventListener('input', e => renderSuggestions(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.replace(',', '').trim();
      if (val) { addSkillTag(val); input.value = ''; suggest?.classList.add('hidden'); }
    } else if (e.key === 'Backspace' && !input.value) {
      const last = arr[arr.length - 1];
      if (last) {
        arr.pop();
        wrap.querySelectorAll('.skill-tag').forEach(t => {
          if (t.textContent.replace('×', '').trim() === last) t.remove();
        });
        if (onChange) onChange();
      }
    }
  });

  // Close suggestions on outside click
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) suggest?.classList.add('hidden');
  });

  // Expose addSkillTag so callers can pre-populate
  return { addSkillTag };
}

// ── Guard: redirect if not logged in / wrong role ───────
async function requireAuth(expectedRole, redirectTo = '/auth.html') {
  const session = await Auth.getSession();
  if (!session) { window.location.href = redirectTo; return null; }

  let profile = await Auth.getUserProfile(session.user.id);
  if (!profile && session.user) {
    profile = await Auth.createUserProfileFromSession(session.user);
  }

  if (!profile) {
    // Profile row missing (e.g. email not yet confirmed or DB insert failed).
    // Sign out and send to auth so they can try again.
    await Auth.signOut();
    window.location.href = redirectTo;
    return null;
  }

  if (expectedRole && profile.role !== expectedRole) {
    // Redirect to the correct dashboard — but only if we won't loop
    const routes = { student: '/student.html', recruiter: '/recruiter.html', admin: '/admin.html' };
    const target = routes[profile.role];
    if (target && window.location.pathname !== target) {
      window.location.href = target;
    }
    return null;
  }

  return { session, profile };
}

// Expose globally
window.showToast = showToast;
window.escHtml = escHtml;
window.fmtDate = fmtDate;
window.setBtnLoading = setBtnLoading;
window.initSkillInput = initSkillInput;
window.requireAuth = requireAuth;
window.SKILL_POOL = SKILL_POOL;