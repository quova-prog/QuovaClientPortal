# WorkOS Auth Flow Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the next WorkOS cutover slice by making visible auth routes AuthKit-driven, adding a tightly scoped pre-org provisioning endpoint, and replacing team invite sends with WorkOS invitations in WorkOS mode.

**Architecture:** Keep `VITE_AUTH_PROVIDER=supabase` as the default and preserve the legacy Supabase Auth screens/invites under that mode. In WorkOS mode, public auth routes redirect to AuthKit, missing-organization users are sent to a local provisioning form, and admin team invites call WorkOS APIs through Edge Functions using server-only `WORKOS_API_KEY`.

**Tech Stack:** Vite/React, `@workos-inc/authkit-react`, Supabase JS, Supabase Edge Functions on Deno, WorkOS REST APIs, static Node security regression tests.

---

### Task 1: Visible AuthKit Routes

**Files:**
- Modify: `src/hooks/useAuth.tsx`
- Modify: `src/pages/LoginPage.tsx`
- Modify: `src/pages/SignupPage.tsx`
- Modify: `src/pages/AcceptInvitePage.tsx`
- Modify: `src/App.tsx`
- Create: `src/pages/WorkosProvisionPage.tsx`
- Create: `src/lib/workosInvite.ts`
- Test: `tests/security/workos-phase6-auth-flow-regression.test.mjs`

- [ ] Add auth context fields for provider mode, WorkOS provisioning requirement, invite acceptance, and org provisioning.
- [ ] Make WorkOS mode detect authenticated users with no selected organization and expose `workosProvisionRequired`.
- [ ] Add `/provision-org` route that is reachable for signed-in WorkOS users without `org_id`.
- [ ] Make `/login`, `/signup`, and `/accept-invite` redirect to AuthKit in WorkOS mode instead of rendering Supabase password/MFA forms.
- [ ] Keep legacy Supabase Auth behavior unchanged while `VITE_AUTH_PROVIDER` is `supabase`.

### Task 2: Pre-Org Provisioning

**Files:**
- Create: `docs/workos/phase3-provisioning-schema.sql`
- Create: `supabase/functions/_shared/workosApi.ts`
- Create: `supabase/functions/provision-org/index.ts`
- Test: `tests/security/workos-phase6-provision-org-regression.test.mjs`

- [ ] Add a SQL Editor artifact for `workos_provisioning_locks` with RLS enabled and no public grants.
- [ ] Implement `provision-org` as the only Edge Function that allows WorkOS tokens without `org_id`.
- [ ] Reject already-linked WorkOS users and rate-limit repeated provisioning attempts by `workos_user_id`.
- [ ] Create a WorkOS organization, create the WorkOS organization membership, create local `banks`, `organisations`, and `profiles` rows, then mark the provisioning lock complete.
- [ ] Return the new WorkOS organization id so the client can call `switchToOrganization`.

### Task 3: WorkOS Team Invitations

**Files:**
- Create: `supabase/functions/workos-team-invites/index.ts`
- Modify: `src/hooks/useTeamMembers.ts`
- Test: `tests/security/workos-phase6-team-invites-regression.test.mjs`

- [ ] Add an admin-only WorkOS team invitations Edge Function that lists, sends, and revokes WorkOS invitations.
- [ ] Ensure WorkOS invite creation sends `organization_id`, `role_slug`, `expires_in_days`, and `inviter_user_id`.
- [ ] Update the team-members hook to use the WorkOS Edge Function only in WorkOS mode.
- [ ] Keep the legacy `invites` table and `send-team-invite` path untouched for Supabase mode.

### Task 4: Verify And Publish

**Files:**
- Review all touched files.

- [ ] Run focused security regressions for auth flow, provisioning, and team invites.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] Run `npm run test:security`.
- [ ] Run `npm run build`.
- [ ] Commit, push, open a PR, and check remote CI/Vercel previews.
