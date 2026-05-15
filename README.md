# Solvoriz — Setup Guide

## File Structure

```
solvoriz/
├── index.html              ← Landing page (marketing only)
├── auth.html               ← Login + Signup
├── student.html            ← Student dashboard
├── recruiter.html          ← Recruiter dashboard
├── admin.html              ← Admin panel
├── supabase_setup.sql      ← Run this in Supabase SQL Editor
└── assets/
    ├── css/
    │   └── style.css       ← All styles (shared across pages)
    └── js/
        ├── supabase.js     ← Supabase client config ← EDIT THIS
        ├── app.js          ← Shared utilities (toast, helpers, skill inputs)
        ├── auth.js         ← Auth module (signup, login, session)
        ├── student.js      ← Student dashboard logic
        ├── recruiter.js    ← Recruiter dashboard logic
        └── admin.js        ← Admin panel logic
```

---

## Step 1: Create a Supabase Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click **New project**
3. Name it `solvoriz`, choose a region, set a strong DB password
4. Wait ~2 minutes for it to provision

---

## Step 2: Run the SQL Setup

1. In your Supabase dashboard, go to **SQL Editor → New query**
2. Paste the entire contents of `supabase_setup.sql`
3. Click **Run**
4. You should see: `Success. No rows returned`

---

## Step 3: Configure Your Credentials

Open `assets/js/supabase.js` and replace the placeholders:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

Find these values in Supabase → **Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY`

---

## Step 4: Disable Email Confirmation (for local testing)

For faster local development:
1. Supabase → **Authentication → Settings**
2. Toggle off **Enable email confirmations**
3. *(Re-enable before going to production)*

> If you see `Email rate limit exceeded` during signup, it usually means Supabase has blocked repeated confirmation email requests for the same address. Disable email confirmations for local testing, or wait a few minutes and try again with a fresh email.

---

## Step 5: Run Locally

Since this is a static site, use any static file server:

**Option A — Python (built-in):**
```bash
cd solvoriz
python3 -m http.server 3000
# Open http://localhost:3000
```

**Option B — Node.js serve:**
```bash
npx serve solvoriz -p 3000
# Open http://localhost:3000
```

**Option C — VS Code Live Server:**
- Install the **Live Server** extension
- Right-click `index.html` → Open with Live Server

---

## Step 6: Create Your Admin Account

1. Go to `http://localhost:3000/auth.html?mode=signup`
2. Sign up with your admin email (choose Student — role gets overridden)
3. In Supabase → **SQL Editor**, run:

```sql
UPDATE public.users
SET role = 'admin'
WHERE email = 'your-admin@email.com';
```

4. Log out, then log back in — you'll be redirected to `/admin.html`

---

## Step 7: Deploy to Cloudflare Pages

1. Push the `solvoriz/` folder to a GitHub repo
2. Go to [Cloudflare Pages](https://pages.cloudflare.com)
3. Connect your GitHub repo
4. Build settings:
   - **Build command:** *(leave empty — static site)*
   - **Build output directory:** `/` (root)
5. Deploy!

No environment variables needed — credentials are in `supabase.js`.

## New MVP features added
- Student profiles now support public handles, visibility settings, avatar URLs, GitHub username, and profile scoring.
- Projects now support project type, image URL, and visibility control.
- Recruiters can send contact requests to students through the platform.
- Admins can approve or revoke recruiter verification and manage featured student projects.
*(For production, consider using Cloudflare Pages environment variables + a build step.)*

---

## User Roles Summary

| Role      | Can do |
|-----------|--------|
| Student   | Create/edit own profile, add/edit/delete own projects |
| Recruiter | Browse all student profiles, filter, shortlist, contact |
| Admin     | View all users & projects, delete any user/project, see stats |

---

## Testing the Full Flow

1. **As a Student:**
   - Sign up → Edit Profile → Add 2–3 projects → Check Overview

2. **As a Recruiter:**
   - Sign up → Browse Talent → Filter by skill → Open a profile → Shortlist

3. **As Admin:**
   - Promote yourself to admin via SQL → Log in → View stats, users, projects

---

## Troubleshooting

**"Failed to load students" on Recruiter page:**
→ Check that `student_profiles` has rows and RLS policies were created correctly.

**Signup succeeds but redirect doesn't work:**
→ Check that the `users` table insert in `auth.js` succeeded — open browser DevTools → Network.

**Admin page redirects back to login:**
→ Make sure you ran the `UPDATE users SET role = 'admin'` query and then logged out + back in.

**CORS errors in console:**
→ Make sure you're running on `http://localhost` (not `file://`). Use one of the serve options above.
