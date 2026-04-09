# SOC 2 Evidence Checklist

- Version: Draft 1.0
- Last updated: 2026-03-31

## Before the Audit Period

- Approved policy set in `docs/compliance/`
- system description finalized and approved
- production monitoring endpoint configured
- branch protection and required review enabled in GitHub
- access review schedule defined
- backup/restore owner identified
- vendor inventory completed
- incident response owner and escalation path documented

## During the Audit Period

Collect recurring evidence for:
- pull request approvals
- CI runs and security workflow results
- `npm audit` results and remediation tracking
- quarterly access reviews
- monitoring alert review cadence
- audit log review cadence
- restore test execution
- incident records and postmortems
- vendor review records

## Repo-Linked Evidence Sources

- authorization/security regression results: `npm run test:security`
- guardrail verification: `npm run verify:guardrails`
- build evidence: `npm run build`
- CI workflow definitions: `.github/workflows/`
- security-sensitive migrations: `supabase/migrations/`
- app monitoring implementation: `src/lib/monitoring.ts`
- audit logging implementation: `src/hooks/useAuditLog.ts`

## Manual Evidence Needed Outside the Repo

- GitHub branch protection settings
- Supabase backup configuration
- Supabase access review results
- Vercel access review results
- monitoring dashboard review records
- incident response tabletop or live test evidence
- signed policy approvals
