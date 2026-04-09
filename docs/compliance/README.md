# Orbit Compliance Starter Pack

This folder contains the repo-side compliance baseline for SOC 2 Type 2 readiness.

Documents in this folder are intentionally practical:
- they describe the current Orbit architecture and control posture based on repo evidence
- they identify operator actions that must happen outside the repo
- they provide a starting point for policy approval, evidence collection, and audit prep

## Contents

- `system-description.md`
  System description for the current Orbit application and supporting services.
- `access-control-policy.md`
  Logical access, role assignment, joiner/mover/leaver, MFA, and access review policy.
- `change-management-policy.md`
  Code, migration, and deployment control requirements.
- `incident-response-policy.md`
  Incident classification, response workflow, evidence handling, and communications.
- `backup-and-restore-policy.md`
  Backup ownership, restore testing, RTO/RPO expectations, and evidence requirements.
- `vendor-management-policy.md`
  Vendor inventory, review cadence, and minimum controls for subservice organizations.
- `evidence-checklist.md`
  Suggested evidence to collect before and during the SOC 2 Type 2 period.

## Repo-aware notes

- Orbit currently runs as a Vite/React frontend with Supabase Auth/Postgres and Vercel hosting.
- Security-sensitive database controls live in `supabase/migrations/`.
- Security regression checks live in `tests/security/authorization-regression.test.mjs`.
- Monitoring events can be sent to a configured endpoint via `VITE_MONITORING_ENDPOINT`.
- CI/security workflows live in `.github/workflows/`.

## Approval and maintenance

- These documents should be reviewed and approved by engineering leadership and the control owner named in each policy.
- Replace placeholders such as owner names, ticket systems, escalation contacts, and recovery objectives with your production values before using them in an audit.
