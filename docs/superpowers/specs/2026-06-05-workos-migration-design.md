# WorkOS Identity Migration - orbit-mvp Design

> Date: 2026-06-05
> Status: Design updated - pending user review, then implementation plan
> Author: Steve LaBella + Codex
> Scope: Replace orbit-mvp's homegrown auth, invite, and MFA stack with WorkOS
> AuthKit as the sole identity issuer, keeping Supabase Postgres and RLS as the
> data plane through Supabase Third-Party Auth.

## 1. Why

orbit-mvp's authentication, team invite, and mandatory MFA flows are homegrown
glue layered on Supabase Auth: a custom `invites` table, invite RPCs, a
`send-team-invite` Edge Function, an `AcceptInvitePage`, a `ForceMfaSetupPage`,
and bespoke TOTP enrollment in `useAuth`. This surface has produced recurring
production friction: boot-error deploys, CORS regressions, audit-trigger
friction during invite cleanup, no admin MFA reset path, and manual SQL fixes.

The strategic driver is larger than those papercuts. orbit-mvp sells direct to
multinationals, and those buyers will require SAML/OIDC SSO, SCIM provisioning,
and self-service enterprise identity configuration as a condition of purchase.
WorkOS is purpose-built for that B2B identity surface.

There are no customers yet. This is the cheapest possible moment to set the
identity foundation. After contracts are signed and SOC2 evidence is collected
against the current flows, this becomes a provider migration with customer data
attached. We do it now, while orbit-mvp is effectively greenfield.

WorkOS is intended to become the standard identity layer for both products:
orbit-mvp direct and quova-platform white-label. This spec covers orbit-mvp
first. quova-platform is a later, separate effort.

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth scope | Full AuthKit. WorkOS owns login, password users, MFA, SSO, sessions, and invitations. | Retires the custom Supabase Auth glue. |
| Identity issuer | WorkOS is the only browser-user JWT issuer accepted by Supabase RLS after cutover. | Avoids dual-issuer policy ambiguity. |
| Data plane | Supabase Postgres remains the authoritative app database. | Existing RLS, audit, and application data remain in place. |
| Customer org membership | One customer user belongs to one Quova customer organization in v1. | Keeps the migration bounded and avoids org-switching complexity. |
| Internal/support users | Support users are a separate internal identity path in orbit-support, backed by a dedicated WorkOS organization. | Preserves support/JIT semantics without giving customer users multi-org access. |
| Local subject key | `profiles.id` remains the internal UUID PK. Add `profiles.workos_user_id` as the external identity bridge. | Existing FKs, audit columns, and created_by/user_id references remain UUIDs. |
| Tenant key | Add `organisations.workos_org_id` and bind RLS to both WorkOS `sub` and WorkOS `org_id`. | Prevents a valid user token from reading the wrong tenant. |
| Role authority | WorkOS organization membership is the provisioning/write authority; `profiles.role` is the local cache used by RLS, joins, UI, and audit. | WorkOS handles invites/SCIM. Supabase handles fast in-DB authorization. |
| MFA control | WorkOS environment-level mandatory MFA replaces the Supabase `aal2` claim gate. | WorkOS tokens do not carry Supabase `aal` claims. |

## 3. External Facts To Validate

These facts were verified against Supabase and WorkOS docs during design review,
but they must be validated in the actual WorkOS/Supabase staging environment
before cutover.

- Supabase supports WorkOS as a first-class Third-Party Auth provider. The
  issuer is `https://api.workos.com/user_management/<client-id>`.
- Supabase requires the JWT `role` claim to match a Postgres role. WorkOS
  organization membership also has a role concept, so the WorkOS JWT template
  must override the JWT `role` to `authenticated` and expose the app membership
  role separately.
- WorkOS `sub` is a string like `user_...`, not a UUID. Supabase `auth.uid()`
  casts `sub::uuid` and cannot be used with WorkOS user IDs.
- WorkOS access tokens carry claims such as `sub`, `sid`, `iss`, `org_id`,
  `role`, `permissions`, `exp`, and `iat`, but they do not carry Supabase
  `aal` or MFA assurance claims.
- WorkOS JWT rendering syntax must be proven with a real decoded token before
  writing RLS. The intended shape is:

```json
{
  "role": "authenticated",
  "user_role": "admin",
  "org_id": "org_..."
}
```

The WorkOS dashboard template may require unquoted template expressions for
JSON-safe rendering. Phase 0 must decode a real token and verify the actual
rendered claim values and types.

## 4. Architecture

```text
orbit-mvp React app
  -> WorkOS AuthKit for login, MFA, SSO, signup, invite acceptance, sessions
  <- WorkOS access token with role=authenticated, sub, org_id, user_role
  -> Supabase client uses accessToken: () => authkit.getAccessToken()
  -> Supabase Postgres RLS reads auth.jwt()

Supabase Postgres
  - Third-Party Auth trusts the WorkOS issuer.
  - RLS resolves the internal profile by WorkOS sub and WorkOS org_id.
  - profiles is the local active membership cache for app authorization.
  - organisations maps internal UUID orgs to WorkOS org IDs.
  - audit, created_by, and user_id columns keep internal UUIDs.

WorkOS
  - Owns auth, sessions, MFA enforcement, organization invitations, SSO, and
    later SCIM/Directory Sync provisioning.
```

## 5. Customer Membership Model

For v1, one WorkOS customer user may belong to only one Quova customer
organization. This is a product constraint, not a WorkOS limitation.

Implementation implications:

- `profiles.workos_user_id` is unique for customer profiles.
- If an admin invites an email whose WorkOS user is already linked to another
  Quova customer organization, the invite is rejected with a clear message.
- The app does not expose customer org switching.
- RLS still requires both `sub` and WorkOS `org_id`, even though the product is
  single-org, so a token without the correct organization context fails closed.
- AuthKit must be configured so normal customer app sessions always have a
  selected WorkOS organization and therefore emit `org_id`. WorkOS only includes
  `org_id` when an organization context is selected. Phase 0 must prove the
  single-org user path auto-selects or otherwise requires org context before
  any RLS cutover.

Future multi-org access should be a separate feature. It would require a
membership table such as `organization_memberships`, org switching UI, audit
attribution by active membership, and revised RLS that keys every request to
the selected WorkOS org. Do not sneak that into this migration.

## 6. Data Model Changes

| Table | Change |
|---|---|
| `profiles` | Add `workos_user_id text UNIQUE`. |
| `profiles` | Ensure `email` is populated from WorkOS and kept current for audit/email display. |
| `profiles` | Add `membership_status text NOT NULL DEFAULT 'active'` with allowed values such as `active`, `pending`, `deactivated`. |
| `profiles` | Add nullable `deactivated_at timestamptz`. |
| `organisations` | Add `workos_org_id text UNIQUE NOT NULL` after backfill/cutover. |
| `support_users` | Add `workos_user_id text UNIQUE`. |
| `audit_logs` | Add actor metadata if needed, such as `actor_type text DEFAULT 'user'` and `external_actor_id text`, so WorkOS webhooks and service-role writes can be represented without forging a user. |
| `invites` | Drop after WorkOS invitation replacement is deployed. |

The internal UUID columns remain in place:

- `profiles.id`
- `support_users.id`
- `created_by`
- `user_id`
- `closed_by`
- `locked_by`
- all audit actor columns

Those UUIDs must be resolved from WorkOS identity through helper functions,
not from `auth.uid()`.

## 7. RLS Identity Helpers

Do not key tenant access by `sub` alone. RLS must bind the WorkOS user and the
WorkOS organization together, and it must require an active local membership.

Required helpers:

```sql
CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.id
    FROM profiles p
    JOIN organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
$$;

CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.org_id
    FROM profiles p
    JOIN organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT p.role
    FROM profiles p
    JOIN organisations o ON o.id = p.org_id
   WHERE p.workos_user_id = auth.jwt()->>'sub'
     AND o.workos_org_id = auth.jwt()->>'org_id'
     AND p.membership_status = 'active'
     AND p.deactivated_at IS NULL
$$;
```

Policy rewrite requirements:

- Every direct `auth.uid()` authorization check must be replaced with one of
  the internal UUID helpers, usually `current_profile_id()`.
- Every direct `(auth.jwt()->>'aal') = 'aal2'` check must be removed only after
  WorkOS mandatory MFA is configured and proven.
- Existing `org_id = current_user_org_id()` policies can remain structurally
  similar after the helper is rewritten, but the implementation plan must still
  enumerate and test them.
- Any support-specific helper must bind to `support_users.workos_user_id`,
  the dedicated internal WorkOS organization, and active support status.
- Customer-path and support-path helpers must stay separate. Customer helpers
  require token `org_id` to match `organisations.workos_org_id`. Support helpers
  require token `org_id` to match the internal WorkOS organization. Support
  access to a customer organization must flow through
  `has_support_access_to(customer_org_id)` and JIT grants, never by treating the
  support token's internal WorkOS org as the customer org.

## 8. Provisioning And Sync

Every authenticated WorkOS user must have a corresponding active local profile
before normal RLS reads can succeed.

### 8.1 Self-Serve Signup

AuthKit signup for a new customer organization calls a new `provision-org` Edge
Function after the WorkOS session exists.

This is the one customer-facing function allowed to accept a valid WorkOS user
token before the token has an organization context. Normal app/API requests
must require WorkOS `org_id`; `provision-org` verifies `sub`, email, and session
validity, then creates the first WorkOS organization membership and local
tenant rows.

The carve-out is intentionally narrow:

- The WorkOS `sub` must not already exist in `profiles.workos_user_id`.
- The endpoint must be idempotent for the same `sub` and requested organization
  name.
- The endpoint must rate-limit by WorkOS `sub` and request IP.
- A provisioning state lock must prevent parallel requests from creating
  duplicate WorkOS organizations.
- `sync-current-user` is not a pre-org carve-out. It mirrors an existing WorkOS
  organization membership and therefore must require `org_id`.

`provision-org` responsibilities:

- Verify the WorkOS JWT.
- Confirm the token represents a new customer signup, not an existing linked
  profile.
- Create or find the WorkOS Organization using an idempotency key or external
  ID.
- Add the current WorkOS user as organization `admin`.
- Create the Supabase `organisations` row with `workos_org_id`.
- Create the Supabase `profiles` row with `workos_user_id`, `org_id`, role
  `admin`, and `membership_status = 'active'`.
- Mirror the WorkOS user email to `profiles.email`.
- Create default notification preferences and onboarding records.
- Write audit logs with an explicit actor context.

Provisioning must be retry-safe. A partial failure after WorkOS org creation
must not create duplicate WorkOS organizations. Use a local provisioning state
record and/or WorkOS external IDs so retries can reconcile the same operation.

### 8.2 Team Invitations

WorkOS Organization Invitations replace the local `invites` table and
`send-team-invite` function.

Admin-facing team actions become WorkOS-backed Edge Function APIs:

- `team-members-list`: read local profiles and, where needed, pending WorkOS
  invitations for the current organization.
- `team-invite-create`: validate local admin role, reject emails already linked
  to another Quova customer organization, create a WorkOS organization
  invitation, and optionally mirror a pending local state if needed for UI.
- `team-invite-revoke`: validate local admin role, revoke the WorkOS invitation,
  and clear any local pending state.
- `team-member-role-update`: validate local admin role, update WorkOS
  membership role first, then mirror `profiles.role`.
- `team-member-deactivate`: validate local admin role, deactivate or remove the
  WorkOS organization membership first, then set local `membership_status` to
  `deactivated` and `deactivated_at = now()`.
- `sync-current-user`: first-login fallback that verifies the WorkOS JWT,
  resolves `org_id` from `organisations.workos_org_id`, upserts the active
  local profile, and creates missing per-user defaults.

WorkOS is the write/provisioning surface. Supabase `profiles` is the local
authorization cache. Any drift is resolved by sync and webhook handlers.

### 8.3 Webhooks And SCIM

Add `workos-webhook`, signature verified with `WORKOS_WEBHOOK_SECRET`.

The handler must be idempotent and able to process:

- organization created/updated events
- organization membership created/updated/deleted events
- user updated/deactivated events
- future Directory Sync / SCIM membership events

Deletion/removal events must deactivate local memberships, not just ignore the
event. A locally deactivated membership must fail RLS even if the user still has
a short-lived WorkOS token.

## 9. Audit And Service-Role Actor Context

The existing audit model assumes Postgres can derive the actor from
`auth.uid()`. After this migration, browser-originated RLS calls can derive the
actor from `current_profile_id()`, but service-role Edge Function writes cannot
rely on `auth.jwt()` inside Postgres unless the actor is explicitly supplied.

Required design:

- Rewrite `write_audit_log()` and the audit log BEFORE INSERT trigger to use
  `current_profile_id()` for browser-user requests.
- Add a trusted service-role audit path for Edge Functions, for example
  `write_audit_log_as_actor(p_actor_profile_id uuid, ...)`, callable only by
  service role.
- Update `enforce_audit_log_fields()` so service-role/workflow writes do not
  fail just because `auth.uid()` is null. The trigger must either read a trusted
  actor context supplied by a SECURITY DEFINER function or set
  `actor_type = 'system'/'workos_webhook'` with WorkOS event metadata.
- Edge Functions that write with service role must verify the WorkOS user JWT,
  resolve the internal actor profile ID, and pass that ID to the service-role
  audit path.
- Webhook-driven writes should use a distinct actor model such as
  `actor_type = 'workos_webhook'` and include WorkOS event IDs in metadata.
- Audit logs must retain internal UUID user IDs for continuity with existing
  reporting and joins.

Affected flows include at minimum:

- `provision-org`
- `sync-current-user`
- WorkOS-backed team invite/member functions
- `workos-webhook`
- any existing Edge Function that switches from user RLS to service-role writes

## 10. Client Changes

Rebuild `useAuth` around `@workos-inc/authkit-react`.

Client responsibilities:

- Use AuthKit for login, signup, MFA, SSO, session refresh, and sign-out.
- Configure the Supabase client with
  `accessToken: () => authkit.getAccessToken()`.
- Build the app user by reading `profiles` and `organisations` through RLS.
- If the profile read fails because the local profile is missing, call
  `sync-current-user`, then retry the read.
- Remove Supabase Auth password and MFA flows from `useAuth`.
- Remove `/mfa-setup` and `/accept-invite`.
- Make `/login` and `/signup` AuthKit-driven.
- Keep `SmartRedirect` onboarding behavior, sourced from the new app user.

Production AuthKit security requirements:

- Use a custom auth domain for production.
- Explicitly prohibit AuthKit `devMode` in production.
- Configure allowed callback, logout, and app URLs for
  `https://app.quovaos.com`.
- Verify token storage behavior in production browser QA.

## 11. Edge Functions

Replace `_shared/auth.ts` user authentication with WorkOS JWT verification.

The new helper should return app authorization context, not a Supabase Auth
`User`:

```ts
type UserAuthContext = {
  workosUserId: string
  workosOrgId: string
  profileId: string
  orgId: string
  role: 'admin' | 'editor' | 'viewer'
  email: string | null
}
```

Requirements:

- Verify the WorkOS JWT signature with JWKS.
- Verify issuer, expiration, audience if applicable, and required claims.
- Require WorkOS `org_id` for customer app requests.
- Allow `provision-org` to opt into a pre-organization mode where `org_id` is
  absent but `sub`, email, issuer, signature, and expiration are still verified.
- Resolve local profile by `workos_user_id` and `workos_org_id`.
- Require `membership_status = 'active'`.
- Keep service-role authentication separate and opt-in per endpoint.
- Keep CORS allowlist behavior.

New secrets:

- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_WEBHOOK_SECRET`

New or replacement functions:

- `provision-org`
- `sync-current-user`
- `workos-webhook`
- `team-members-list`
- `team-invite-create`
- `team-invite-revoke`
- `team-member-role-update`
- `team-member-deactivate`

Existing functions using `authenticateUserAal2()` must migrate to the new
helper and update any `auth.user.id` assumptions to `auth.profileId`.

## 12. Support Portal

orbit-support must be cut over in the same shared-DB window because the
Supabase project will trust a single WorkOS issuer after cutover.

Support design:

- Dedicated WorkOS organization: "Quova Internal".
- `support_users.workos_user_id` maps support staff identities.
- Support helpers such as `is_support_user()` and
  `has_support_access_to(org_id)` re-key to WorkOS `sub` and active support
  user status.
- Support RLS must also require the expected internal WorkOS organization
  context.
- The orbit-support frontend migration is executed in the sibling repo as its
  own implementation plan, but the DB migrations are part of this shared
  cutover.

## 13. What Gets Deleted

Delete after replacement flows are deployed and verified:

- `invites` table and RLS
- `accept_invite()` RPC
- `send-team-invite` Edge Function
- `teamInviteEmail` template
- `AcceptInvitePage`
- `ForceMfaSetupPage`
- Supabase Auth password signup/signin logic in `useAuth`
- Supabase MFA enrollment/challenge code in `useAuth` and `useMfa`
- `aal2` claim checks in RLS, RPCs, tests, and Edge Functions

Do not delete until replacement WorkOS flows pass staging QA.

## 14. Migration And Cutover

This is a staged hard cutover because there are no customers yet, but it still
must be reversible until the final cleanup step.

### Phase 0: Staging Spike

- Create WorkOS staging environment.
- Configure AuthKit, mandatory MFA, roles, orgs, and JWT template.
- Configure and prove single-org customer sessions select a WorkOS organization
  context so normal tokens always include `org_id`.
- Configure Supabase Third-Party Auth with the WorkOS issuer.
- Decode a real WorkOS token and verify `role`, `user_role`, `org_id`, `sub`,
  `iss`, `exp`, and `sid`.
- Prove a real token can read one tenant-scoped row through Supabase RLS.
- Prove negative cases: missing `org_id`, wrong `org_id`, unknown `sub`,
  inactive local membership, and old Supabase JWT.
- Resolve any `JWSInvalidSignature` or JWKS/issuer mismatch before continuing.

### Phase 1: Additive Database Changes

- Add `workos_*` columns.
- Add `membership_status` and `deactivated_at`.
- Add new identity helper functions alongside old ones.
- Add trusted audit actor helpers.
- Add static regression tests around helper SQL.
- Do not flip existing RLS policies yet.

### Phase 2: Inventory And Re-key Plan

Generate a complete callsite inventory before implementation. Current repo
signal during design review:

- 161 `auth.uid()` references
- 52 files containing `auth.uid()`
- 185 AAL/MFA references

The implementation plan must classify each reference as:

- RLS helper
- table policy
- SECURITY DEFINER RPC
- audit trigger
- support RPC/policy
- Edge Function user lookup
- frontend Supabase Auth/MFA code
- static regression test expectation
- dead migration history kept only for record

No policy/RPC cutover should start until this inventory exists.

### Phase 3: WorkOS Edge Functions And Client

- Add WorkOS JWT verification helper.
- Add provisioning/sync/team/webhook functions.
- Implement `provision-org` as the only no-`org_id` user endpoint, with
  no-existing-profile checks, idempotency, rate limiting, and provisioning
  locks.
- Implement customer and support auth helpers separately so JIT support access
  cannot be confused with customer org-token matching.
- Rebuild `useAuth` around AuthKit.
- Update team settings UI to call WorkOS-backed Edge Functions.
- Update Supabase client access token configuration.
- Update tests.

### Phase 4: Coordinated Cutover

- Recreate internal users in WorkOS.
- Re-key RLS helpers and policies.
- Re-key audit triggers and write RPCs.
- Re-key support helpers and support frontend.
- Deploy Edge Functions.
- Deploy app.
- Run live positive and negative staging QA.

### Phase 5: Cleanup

- Drop old invite/auth/MFA artifacts.
- Remove old tests that assert Supabase Auth/AAL2 behavior.
- Regenerate Supabase types.
- Confirm Vercel and Supabase production health.

Migrations are applied through the Supabase Dashboard SQL editor because the
existing migration history is desynchronized and `supabase db push` is unsafe.

## 15. Testing

Static regression tests:

- Helpers require matching WorkOS `sub` and WorkOS `org_id`.
- Helpers reject inactive/deactivated memberships.
- Missing/foreign `sub` returns NULL.
- Missing/wrong `org_id` returns NULL.
- No `auth.uid()` remains in active re-keyed policies or RPC bodies.
- No `aal2` clauses remain after cutover.
- Audit triggers write the correct internal UUID.
- `invites` and `accept_invite` are dropped after cleanup.

Unit tests:

- WorkOS claim parsing.
- Role mapping.
- First-login sync mapping.
- Webhook event mapping.
- Single-org invite conflict handling.

Live staging QA:

- Self-serve signup provisions WorkOS org and Supabase org/profile.
- Team invite creates WorkOS invitation and no local `invites` row.
- Invitee accepts, first-login sync creates active local profile.
- Role update changes WorkOS membership first and local cache second.
- Member deactivation fails RLS immediately after local status update.
- SSO login succeeds.
- Support login succeeds in orbit-support.
- Customer token cannot read support-only data.
- Support token cannot read customer data without JIT access.
- User A cannot read org B.
- Token with correct `sub` but wrong `org_id` cannot read data.
- Old Supabase JWT cannot read data after cutover.

## 16. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| WorkOS/Supabase issuer or JWKS mismatch | Phase 0 round-trip before cutover. |
| WorkOS JWT template renders unexpected claim types | Decode real tokens and assert claims before writing RLS. |
| RLS keyed only by `sub` leaks wrong tenant | Bind helpers to both `sub` and WorkOS `org_id`. |
| Removed user keeps a short-lived token | Require local active membership in helpers. |
| Service-role writes lose audit actor | Add explicit trusted audit actor path for Edge Functions. |
| WorkOS role names drift from app enum | Configure roles exactly and add role-mapping tests. |
| First-login sync and webhook race | Idempotent upsert keyed on `workos_user_id` with org match. |
| Partial provisioning creates orphan WorkOS orgs | Use idempotency/external IDs and local provisioning state. |
| Multi-org customer access sneaks into migration | Block it explicitly for v1; make it a separate feature later. |
| orbit-support lags DB cutover | Sequence support frontend and shared DB cutover together. |
| `auth.uid()` remains in active code | Generated inventory plus static tests before cutover. |
| Data API grants missing for new exposed objects | Explicit GRANT/REVOKE review for every new RPC/table. |
| WorkOS pricing/tier mismatch | Confirm AuthKit, Organizations, SSO, and SCIM plan before cutover. |

## 17. Out Of Scope

- quova-platform migration.
- Customer-specific SCIM rollout.
- Multi-customer membership for one customer user.
- Data migration for real customer `auth.users` records, because there are no
  customers yet.
