# WorkOS Phase 3 AuthKit Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for code changes and superpowers:verification-before-completion before claiming completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the WorkOS/AuthKit client and Edge authentication foundation behind a feature flag, without replacing the current Supabase Auth production flow yet.

**Architecture:** This slice introduces WorkOS environment guardrails, client-side JWT claim parsing for app UX, a Supabase access-token provider hook, and an additive WorkOS Edge auth helper. Existing Supabase Auth routes, MFA checks, and Edge functions remain active until the later cutover slice rewires `useAuth`, team management, and RLS policies.

**Tech Stack:** Vite/React, Vitest, Supabase JS `accessToken` option, Supabase Edge Functions on Deno, WorkOS AuthKit tokens, static Node security regression tests.

---

### Task 1: Add WorkOS Config And Claim Tests First

**Files:**
- Create: `src/lib/workosConfig.test.ts`
- Create: `src/lib/workosClaims.test.ts`
- Create later: `src/lib/workosConfig.ts`
- Create later: `src/lib/workosClaims.ts`

- [x] **Step 1: Write failing config tests**

Assert that:

- `VITE_AUTH_PROVIDER` defaults to `supabase`.
- Only `supabase` and `workos` are accepted.
- WorkOS mode requires `VITE_WORKOS_CLIENT_ID`.
- Production WorkOS mode rejects `VITE_WORKOS_DEV_MODE=true`.
- WorkOS redirect URI, if present, must be HTTPS outside localhost development.

- [x] **Step 2: Write failing claim tests**

Assert that:

- Normal customer tokens require `sub`, `role = authenticated`, `user_role`, and `org_id`.
- Missing `org_id` fails normal customer validation.
- `provision-org` pre-org validation allows missing `org_id` but still requires `sub`, issuer, role, and expiration.
- Supported app roles map only to `admin`, `editor`, or `viewer`.
- Claim parsing is explicitly unsigned/client-side only and does not pretend to verify token signatures.

- [x] **Step 3: Run focused Vitest checks and confirm red**

Run:

```bash
npm run test -- src/lib/workosConfig.test.ts src/lib/workosClaims.test.ts
```

Expected: fail because the implementation files do not exist yet.

### Task 2: Implement Client Foundation

**Files:**
- Create: `src/lib/workosConfig.ts`
- Create: `src/lib/workosClaims.ts`
- Update: `src/lib/supabase.ts`
- Update: `.env.example`

- [x] **Step 1: Add WorkOS config helper**

Implement a pure helper that reads a supplied env-like object, returns the active auth provider, and throws actionable errors for invalid WorkOS configuration. Keep `supabase` as the default provider so current production behavior does not change until Vercel env vars are intentionally flipped.

- [x] **Step 2: Add WorkOS claim parser**

Implement base64url JWT payload parsing and claim validation for client UX and tests. Name the parser to make clear that it is not signature verification; Edge Functions still perform cryptographic verification.

- [x] **Step 3: Add Supabase token provider hook**

Expose `setSupabaseAccessTokenProvider(provider)` and configure the Supabase client with the `accessToken` option only when a provider returns a token. Preserve existing Supabase Auth session behavior when no WorkOS provider is registered.

- [x] **Step 4: Document required env vars**

Add non-secret WorkOS env examples:

- `VITE_AUTH_PROVIDER=supabase`
- `VITE_WORKOS_CLIENT_ID=`
- `VITE_WORKOS_REDIRECT_URI=`
- `VITE_WORKOS_DEV_MODE=false`

### Task 3: Add Static Regression Coverage For Edge WorkOS Auth

**Files:**
- Create: `tests/security/workos-phase3-auth-helper-regression.test.mjs`
- Create later: `supabase/functions/_shared/workosAuth.ts`

- [x] **Step 1: Write failing static security tests**

Assert that the WorkOS Edge helper:

- Verifies JWTs with WorkOS JWKS.
- Verifies issuer with `WORKOS_CLIENT_ID`.
- Requires `org_id` for normal customer auth.
- Allows missing `org_id` only through an explicit pre-org option.
- Resolves local profile through `profiles.workos_user_id` and `organisations.workos_org_id`.
- Requires `membership_status = active` and `deactivated_at IS NULL`.
- Returns internal UUIDs (`profileId`, `orgId`) plus WorkOS IDs.
- Does not accept service-role tokens or combine user and service-role auth.

- [x] **Step 2: Run the focused Node regression test and confirm red**

Run:

```bash
node --test tests/security/workos-phase3-auth-helper-regression.test.mjs
```

Expected: fail because the helper does not exist yet.

### Task 4: Implement Additive Edge WorkOS Auth Helper

**Files:**
- Create: `supabase/functions/_shared/workosAuth.ts`

- [x] **Step 1: Add cryptographic JWT verification**

Use JOSE in Deno to verify the bearer token against WorkOS JWKS and issuer `https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`. Keep this in a new helper rather than replacing `_shared/auth.ts` yet.

- [x] **Step 2: Add app authorization context resolution**

For normal customer auth, resolve the local active profile using WorkOS `sub` and `org_id`, returning:

```ts
type WorkosUserAuthContext = {
  workosUserId: string
  workosOrgId: string
  profileId: string
  orgId: string
  role: 'admin' | 'editor' | 'viewer'
  email: string | null
}
```

- [x] **Step 3: Add pre-org verification mode**

Allow only an explicit option such as `{ allowMissingOrgId: true }` to return a verified pre-org identity for `provision-org`. Do not resolve a customer profile in this mode.

### Task 5: Verify The Foundation Slice

- [x] **Step 1: Run focused tests**

```bash
npm run test -- src/lib/workosConfig.test.ts src/lib/workosClaims.test.ts
node --test tests/security/workos-phase3-auth-helper-regression.test.mjs
```

- [x] **Step 2: Run broad local verification**

```bash
npm run test
npm run test:security
npm run build
```

- [x] **Step 3: Review diff for secrets and accidental cutover**

Confirm:

- No `.env*` files are staged.
- No WorkOS access tokens, API keys, Supabase service role keys, or JWTs are committed.
- `VITE_AUTH_PROVIDER` default remains `supabase`.
- Existing Supabase Auth routes and Edge functions are not removed in this slice.

### Task 6: Commit And Open A PR

- [ ] **Step 1: Stage only Phase 3 foundation files**
- [ ] **Step 2: Commit with `chore(workos): add authkit foundation`**
- [ ] **Step 3: Push branch and open a draft PR**
