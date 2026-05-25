# Solvoriz Architecture Audit

## Root Causes Found

1. `public.conversations` was originally recruiter-student only.
   - `trg_validate_conversation_membership` required `recruiter_id` to have role `recruiter`.
   - It also required `verified_recruiter = true`.
   - It required `project_id` to be non-null and owned by `student_id`.
   - Builder DMs later reused the same table, so `ensure_direct_conversation()` could create IDs in code but fail in the database.

2. Message policies and triggers conflicted.
   - Insert policy required `project_id IS NOT NULL`.
   - Update policies were dropped later in `supabase_setup.sql`.
   - `enforce_message_immutability()` rejected all normal edits.
   - There was no sender delete policy.

3. Creator chat had two competing models.
   - `creator_conversations` / `creator_messages` exist.
   - Newer DM code calls `ensure_direct_conversation()` and inserts into `messages`.
   - Notification validation still expected `creator_conversations`, so creator discussion notifications could fail.

4. Sender identity was under-fetched.
   - Some message queries selected only `*`, so there was no joined `users`/`student_profiles` row to render names or avatars.
   - Recruiter message UI still rendered raw bubbles without sender identity.

5. Community message RLS was fragile.
   - Group policies used unqualified `group_id` references.
   - Sender joins did not fetch avatar/profile details.

6. Project delete was incomplete.
   - Existing RPC deleted project assets/comments/projects only.
   - Launch posts, social comments, social reactions, upvotes, bookmarks, and storage references could remain.

7. Realtime was configured in the frontend, but backend publication and failed inserts meant events often never fired.
   - Tables must be added to `supabase_realtime`.
   - Subscriptions now log their status in the browser console.

## Repair Files

- `sql/core_architecture_repair.sql`
  - Drops stale recruiter-only conversation triggers.
  - Replaces conversation/message RLS with participant-safe policies.
  - Replaces `ensure_direct_conversation()`.
  - Enables message edit/delete/read receipts.
  - Fixes community group policies.
  - Replaces notification validation.
  - Rebuilds delete cascade.
  - Adds realtime publication entries.

- `assets/js/student.js`
  - Adds identity joins, logging, realtime status logs, better message errors.

- `assets/js/recruiter.js`
  - Adds sender identity joins and logging for the other side of the DM loop.

- `assets/js/auth.js`
  - Fixes short/invalid username fallback during profile bootstrap.

- `assets/js/app.js`
  - Adds centralized debug/error logging.

## Validation Checklist

After applying `sql/core_architecture_repair.sql`:

1. Sign in as two builder accounts.
2. Open one builder from Community and send a DM.
3. Confirm `conversations` has one row and `messages` has the new message.
4. Confirm both dashboards show sender display name, username, avatar fallback, timestamp.
5. Send a second message with both browsers open and watch realtime update.
6. Create a group, join it from another account, send a group message.
7. Create a project, confirm it appears on the public profile.
8. Delete the project, confirm linked social post/comments/reactions/upvotes/bookmarks are gone.
