(function () {
  const FEEDBACK_TYPES = ['Bug', 'Feature Request', 'Confusing UI', 'General Feedback'];

  function buildFeedbackUI() {
    if (document.getElementById('feedback-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'feedback-fab';
    fab.className = 'feedback-fab';
    fab.type = 'button';
    fab.textContent = 'Feedback';
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-controls', 'feedback-modal');

    const modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <span class="modal-header__title">Share feedback</span>
          <button class="modal-close" type="button" data-feedback-close aria-label="Close feedback modal">x</button>
        </div>
        <div class="modal-body">
          <form id="feedback-form">
            <div class="form-group">
              <label for="feedback-type">Category</label>
              <select id="feedback-type" class="select input" required>
                ${FEEDBACK_TYPES.map((type) => `<option value="${type}">${type}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="feedback-message">What should we know?</label>
              <textarea id="feedback-message" class="textarea" maxlength="2000" placeholder="Tell us what happened, what felt confusing, or what you would like to see improved." required></textarea>
            </div>
            <div class="form-group">
              <label for="feedback-screenshot">Optional screenshot link</label>
              <input id="feedback-screenshot" class="input" type="url" placeholder="https://example.com/screenshot.png">
            </div>
            <button id="feedback-submit-btn" class="btn btn--primary btn-full" type="submit">Send feedback</button>
            <p class="feedback-helper">Feedback can be sent with or without an account. If you are signed in, it will be tied to your user ID automatically.</p>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(modal);

    fab.addEventListener('click', openFeedbackModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.matches('[data-feedback-close]')) {
        closeFeedbackModal();
      }
    });

    const form = document.getElementById('feedback-form');
    if (form) form.addEventListener('submit', submitFeedback);
  }

  function openFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const messageInput = document.getElementById('feedback-message');
    if (messageInput) setTimeout(() => messageInput.focus(), 30);
  }

  function closeFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const btn = document.getElementById('feedback-submit-btn');
    const type = document.getElementById('feedback-type')?.value;
    const message = document.getElementById('feedback-message')?.value.trim();
    const screenshotUrl = document.getElementById('feedback-screenshot')?.value.trim();

    if (!message) {
      showToast('Please add a short message before submitting.', 'warn');
      return;
    }

    setBtnLoading(btn, true, 'Sending...');

    try {
      const session = window.Auth ? await window.Auth.getSession() : null;
      const payload = {
        user_id: session?.user?.id || null,
        type,
        message,
        screenshot_url: screenshotUrl || null,
        page_path: window.location.pathname
      };

      const { error } = await window.sb.from('feedback').insert(payload);
      if (error) throw error;

      document.getElementById('feedback-form')?.reset();
      closeFeedbackModal();
      showToast('Thanks. Your feedback was submitted.', 'success');
    } catch (error) {
      console.error('Feedback submit failed', error);
      showToast(error.message || 'Could not submit feedback right now.', 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  function initFaqToggles() {
    document.querySelectorAll('[data-faq-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const answer = button.nextElementSibling;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        answer?.classList.toggle('hidden', expanded);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildFeedbackUI();
    initFaqToggles();
  });
})();
