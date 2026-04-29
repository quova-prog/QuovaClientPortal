# Multi-User Email Notifications Plan

## Current State
- **Roles**: admin / editor / viewer — enforced via RLS + client checks
- **Notification preferences**: per-user row in `notification_preferences` (user_id UNIQUE)
- **Alerts**: org-scoped (all users see same alerts), write restricted to admin/editor
- **Email sending**: Edge Functions query `notification_preferences` to find eligible recipients per org
- **Team management**: None — single-user MVP, roles set via support portal
- **No invite system, no team member list, no role change UI**

## What "Multiple Users & User Types" Means for Email

The email system already supports multiple users per org at the **database level** — each user gets their own `notification_preferences` row, and the Edge Functions iterate over all eligible users in an org. What's missing:

1. **Team management UI** — admins can't invite users or manage roles
2. **Admin visibility into team notification settings** — admin can't see who gets what emails
3. **Role-based notification defaults** — viewers probably shouldn't get urgent ops alerts by default

## Implementation Plan

### Phase 1: Team Management (Settings > Organisation tab)

**Migration: `20260413_invites.sql`**
```
invites table:
  id, org_id, email, role, invited_by, accepted_at, expires_at, created_at
  RLS: admin-only INSERT/SELECT/DELETE
```

**RPC: `invite_team_member(email, role)`**
- Admin-only guard
- Creates invite row + sends Supabase auth invite email
- If user already exists in auth.users, links to org directly

**RPC: `accept_invite(invite_id)`**
- Called on signup when invite token is present
- Sets profile.org_id and profile.role from invite

**RPC: `update_member_role(user_id, new_role)`**
- Admin-only, prevents demoting last admin
- Updates profiles.role

**RPC: `remove_member(user_id)`**
- Admin-only, prevents removing last admin
- Deletes profile row (cascades notification_preferences, etc.)

**UI: Team Members section in Organisation tab**
- Table: Name, Email, Role, Status (active/pending), Actions
- "Invite Member" button → modal with email + role picker
- Role dropdown (admin only) to change roles inline
- Remove button with confirmation
- Pending invites shown with "Resend" / "Revoke" actions

### Phase 2: Admin Notification Overview

**New section in Settings > Notifications (admin only)**

Below the user's own preferences, add a "Team Notification Summary" card:
- Table showing each team member: Name, Urgent Emails (on/off), Digest (on/off), Frequency
- Read-only — admins can see coverage but can't override individual preferences
- Visual indicator if no one in the org has urgent emails enabled (warning banner)

**Migration: Add admin SELECT policy on notification_preferences**
```sql
CREATE POLICY "notif_prefs_admin_select" ON notification_preferences
  FOR SELECT USING (
    org_id = current_user_org_id()
    AND current_user_role() = 'admin'
  );
```

**Hook update: `useTeamNotificationSummary()`**
- Admin-only hook that fetches all notification_preferences rows for the org
- Joins with profiles to get name/role
- Returns summary array

### Phase 3: Role-Based Notification Defaults

**Update `DEFAULT_PREFS` to be role-aware:**

| Setting | Admin | Editor | Viewer |
|---------|-------|--------|--------|
| email_urgent | true | true | false |
| email_digest | true | false | false |
| digest_frequency | daily | daily | daily |
| alert_types | all 4 | all 4 | policy_breach only |

**Where applied:**
- `useNotificationPreferences.ts` — pass role into DEFAULT_PREFS lookup when auto-creating row
- `notification_preferences` migration — keep DB defaults as-is (admin defaults), let app logic handle role-specific defaults on INSERT

### Phase 4: Email Logs Visibility (Admin)

**New section in Settings > Notifications (admin only): "Email History"**
- Table of recent email_logs: Date, Recipient, Type (urgent/digest), Subject, Status
- Filterable by type and date range
- Already has admin-only RLS policy (`email_logs_select_admin`)

**Hook: `useEmailLogs()`**
- Fetches from `email_logs` table (admin-only via RLS)
- Paginated, most recent first

## File Changes Summary

| File | Change |
|------|--------|
| `supabase/migrations/20260413_invites.sql` | New: invites table + RLS |
| `supabase/migrations/20260413_team_rpcs.sql` | New: invite/accept/update_role/remove RPCs |
| `supabase/migrations/20260413_notif_admin_select.sql` | New: admin SELECT policy on notification_preferences |
| `src/hooks/useTeamMembers.ts` | New: CRUD hook for team management |
| `src/hooks/useTeamNotificationSummary.ts` | New: admin-only notification overview |
| `src/hooks/useEmailLogs.ts` | New: admin-only email history |
| `src/hooks/useNotificationPreferences.ts` | Update: role-aware defaults |
| `src/pages/SettingsPage.tsx` | Update: Team Members section in Organisation tab, Team Notification Summary + Email History in Notifications tab |

## Execution Order

1. **Phase 1** first — invites + team management (foundational)
2. **Phase 2** next — admin notification overview (depends on multi-user)
3. **Phase 3** alongside Phase 2 — role-based defaults (small change)
4. **Phase 4** last — email logs (nice-to-have, admin visibility)

## Questions for You

None blocking — all three user types (admin/editor/viewer) are already defined and enforced. The plan extends the existing role system rather than changing it.
