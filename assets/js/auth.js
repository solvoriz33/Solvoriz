// ============================================================
// AUTH.JS — Handles all authentication logic
// ============================================================

const Auth = (() => {

  // ── Sign Up ─────────────────────────────────────────────
  async function signUp({ email, password, fullName, role }) {
    try {
      const { data, error } = await window.sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, role }
        }
      });
      if (error) throw error;

      if (data.user) {
        // Insert into public users table
        const { error: dbErr } = await window.sb.from('users').insert({
          id: data.user.id,
          full_name: fullName,
          email,
          role
        });
        if (dbErr) throw dbErr;
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  // ── Sign In ─────────────────────────────────────────────
  async function signIn({ email, password }) {
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
    const { error } = await window.sb.auth.signOut();
    return error;
  }

  // ── Get current session ─────────────────────────────────
  async function getSession() {
    const { data } = await window.sb.auth.getSession();
    return data?.session || null;
  }

  // ── Get user role from DB ───────────────────────────────
  async function getUserRole(userId) {
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
    const { data, error } = await window.sb
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data;
  }

  // ── Listen to auth state changes ────────────────────────
  function onAuthStateChange(callback) {
    return window.sb.auth.onAuthStateChange(callback);
  }

  return { signUp, signIn, signOut, getSession, getUserRole, getUserProfile, onAuthStateChange };
})();

window.Auth = Auth;