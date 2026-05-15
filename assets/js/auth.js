// ============================================================
// AUTH.JS — Handles all authentication logic
// ============================================================

const Auth = (() => {

  function formatAuthError(err) {
    if (!err) return err;
    const message = String(err.message || err.error_description || '').trim();
    if (message.includes('Email rate limit exceeded')) {
      return new Error('Too many signup email messages were sent to this address. Please check your inbox or try again later.');
    }
    if (message.toLowerCase().includes('already registered') || message.toLowerCase().includes('user already exists')) {
      return new Error('This email is already registered. Please sign in instead.');
    }
    return err;
  }

  // ── Sign Up ─────────────────────────────────────────────
  async function signUp({ email, password, fullName, role }) {
    if (!window.sb || !window.sb.auth) return { data: null, error: new Error('Supabase client not initialized') };
    try {
      const { data, error } = await window.sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, role }
        }
      });
      if (error) throw formatAuthError(error);

      // data.user is non-null only when the user is immediately confirmed
      // (email confirmation disabled). When confirmation is required,
      // data.user exists but data.session is null — we still insert the row
      // so the profile is ready once they confirm.
      // Only insert a profile row when we have an active session (i.e. the
      // client is authenticated). If email confirmation is required the
      // `signUp` response may include `data.user` but `data.session` will be
      // null — attempting a DB insert without a valid session triggers a
      // 401 under Row Level Security. In that case, skip the insert and let
      // the server-side / post-confirmation flow create the profile.
      if (data.session && data.session.user) {
        const user = data.session.user;
        const { error: dbErr } = await window.sb.from('users').insert({
          id: user.id,
          full_name: fullName,
          email,
          role
        });
        // Ignore duplicate-key errors (user already exists)
        if (dbErr && dbErr.code !== '23505') throw dbErr;
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: formatAuthError(err) };
    }
  }

  // ── Sign In ─────────────────────────────────────────────
  async function signIn({ email, password }) {
    if (!window.sb || !window.sb.auth) return { data: null, error: new Error('Supabase client not initialized') };
    try {
      const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // ── Sign Out ────────────────────────────────────────────
  async function signOut() {
    if (!window.sb || !window.sb.auth) return new Error('Supabase client not initialized');
    const { error } = await window.sb.auth.signOut();
    return error;
  }

  // ── Get current session ─────────────────────────────────
  async function getSession() {
    if (!window.sb || !window.sb.auth) return null;
    const { data } = await window.sb.auth.getSession();
    return data?.session || null;
  }

  // ── Get user role from DB ───────────────────────────────
  async function getUserRole(userId) {
    if (!window.sb) return null;
    const { data, error } = await window.sb
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data?.role || null;
  }

  // ── Get full user profile row ───────────────────────────
  async function getUserProfile(userId) {
    if (!window.sb) return null;
    const { data, error } = await window.sb
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data;
  }

  async function createUserProfileFromSession(user) {
    if (!window.sb || !user) return null;
    const role = user.user_metadata?.role || 'student';
    const full_name = user.user_metadata?.full_name || user.email?.split('@')[0] || '';
    const email = user.email || '';
    if (!user.id || !email) return null;

    const { data, error } = await window.sb.from('users').insert({
      id: user.id,
      full_name,
      email,
      role
    }).select().maybeSingle();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await window.sb
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();
        return existing;
      }
      return null;
    }

    return data;
  }

  // ── Listen to auth state changes ────────────────────────
  function onAuthStateChange(callback) {
    if (!window.sb || !window.sb.auth) return { data: null, error: new Error('Supabase client not initialized') };
    return window.sb.auth.onAuthStateChange(callback);
  }

  return { signUp, signIn, signOut, getSession, getUserRole, getUserProfile, createUserProfileFromSession, onAuthStateChange };
})();

window.Auth = Auth;