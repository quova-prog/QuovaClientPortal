# WorkOS Phase 0 Validation Result

Date: 2026-06-06

## Token Assertion

Command:

```bash
node scripts/workos/phase0-assert-workos-token.mjs
```

Output:

```json
{
  "header_alg": "RS256",
  "iss": "https://api.workos.com/user_management/client_01KTE5T075Z690RG2SY5YG1ZYG",
  "sub": "user_01KTE84N35C8D23H6D26ZXX5YA",
  "org_id": "org_01KTE6RCDXW9ZSQ0F6PCMN4KRP",
  "role": "authenticated",
  "user_role": "admin",
  "sid": "session_01KTEA4WQ38SG7J6AGW8130AP4",
  "exp": 1780745623
}
```

## RLS Probe Seeding

Command:

```bash
node scripts/workos/phase0-seed-rls-probe.mjs
```

Output:

```json
[
  {
    "id": "allowed",
    "workos_user_id": "user_01KTE84N35C8D23H6D26ZXX5YA",
    "workos_org_id": "org_01KTE6RCDXW9ZSQ0F6PCMN4KRP",
    "visible_label": "allowed row for matching WorkOS sub and org"
  },
  {
    "id": "wrong-org",
    "workos_user_id": "user_01KTE84N35C8D23H6D26ZXX5YA",
    "workos_org_id": "org_phase0_wrong",
    "visible_label": "row with matching user and wrong org"
  },
  {
    "id": "wrong-user",
    "workos_user_id": "user_phase0_wrong",
    "workos_org_id": "org_01KTE6RCDXW9ZSQ0F6PCMN4KRP",
    "visible_label": "row with wrong user and matching org"
  }
]
```

## RLS Smoke

Command:

```bash
node scripts/workos/phase0-rls-smoke.mjs
```

Output:

```json
{
  "rows_visible": 1,
  "visible_ids": [
    "allowed"
  ],
  "sub": "user_01KTE84N35C8D23H6D26ZXX5YA",
  "org_id": "org_01KTE6RCDXW9ZSQ0F6PCMN4KRP"
}
```

## Identity Inventory Summary

```json
{
  "auth_uid": {
    "matches": 161,
    "files": 52,
    "by_category": {
      "migration": 159,
      "edge-function": 2
    }
  },
  "aal_or_mfa": {
    "matches": 185,
    "files": 25,
    "by_category": {
      "test": 7,
      "edge-function": 12,
      "migration": 51,
      "frontend": 115
    }
  },
  "supabase_auth": {
    "matches": 218,
    "files": 63,
    "by_category": {
      "edge-function": 49,
      "test": 4,
      "migration": 51,
      "frontend": 114
    }
  },
  "invite_flow": {
    "matches": 74,
    "files": 14,
    "by_category": {
      "test": 1,
      "edge-function": 8,
      "migration": 41,
      "frontend": 24
    }
  },
  "support_identity": {
    "matches": 147,
    "files": 21,
    "by_category": {
      "edge-function": 1,
      "migration": 140,
      "frontend": 6
    }
  },
  "audit_identity": {
    "matches": 134,
    "files": 34,
    "by_category": {
      "migration": 118,
      "test": 4,
      "frontend": 12
    }
  }
}
```

## Gate Decision

Phase 0 passed because the decoded token has `role = authenticated`, has a
real WorkOS `org_id`, has a Quova `user_role`, the Supabase RLS smoke script
returned only the `allowed` row, and the generated identity callsite inventory
exists.

Decision: PASS
