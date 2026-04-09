# Access Control Policy

- Version: Draft 1.0
- Control owner: Security Lead
- Review cadence: At least annually and after material auth/authorization changes
- Last updated: 2026-03-31

## Purpose

This policy defines how access to Orbit systems and customer data is requested, approved, granted, reviewed, and revoked.

## Scope

This policy applies to:
- source code repositories
- Supabase projects and database access
- Vercel projects
- GitHub organization/repositories
- monitoring and operational tooling
- any vendor or contractor accounts with access to Orbit systems

## Principles

- Access is granted using least privilege.
- Production access is limited to personnel with a documented business need.
- Shared accounts are prohibited unless technically required and explicitly approved.
- Administrative actions must be attributable to an individual.
- MFA is required for privileged administrative access where supported.

## Application Roles

Observed application roles in repo:
- `admin`
- `editor`
- `viewer`

Requirements:
- `admin` is limited to users who manage organization configuration and high-impact data.
- `editor` is limited to users who need operational write access.
- `viewer` is the default role for read-only access.
- Role assignment and changes must be approved by an authorized admin or control owner.

## Provisioning

Access requests must include:
- user identity
- requested system and role
- business justification
- approver
- requested start date

Provisioning requirements:
- repository access must be granted through named GitHub accounts
- Supabase dashboard access must be limited to approved administrators
- Vercel deployment access must be limited to approved operators
- production secrets access must be limited to approved operators

## Joiner / Mover / Leaver Controls

Joiners:
- access is granted only after documented approval
- privileged access requires MFA enrollment where supported

Movers:
- access is re-evaluated when job responsibilities change
- elevated access that is no longer required must be removed within 1 business day

Leavers:
- access must be revoked on termination date, or immediately for involuntary termination
- all active sessions and tokens must be invalidated where supported

## Access Reviews

Quarterly reviews must cover:
- GitHub repository access
- Supabase project and dashboard access
- Vercel project access
- monitoring and operational tooling access
- application admin users when feasible

Evidence retained for each review:
- reviewer
- date completed
- systems reviewed
- exceptions identified
- remediation actions and completion dates

## Authentication and MFA

Requirements:
- unique user accounts are required
- password authentication must follow provider-supported baseline controls
- MFA must be enabled for privileged/operator accounts where supported
- repeated failed login and MFA events must be monitored

Repo-aware notes:
- Orbit supports MFA enrollment and verification in-app
- login and MFA lockout events are monitored in the frontend telemetry path

## Emergency Access

Emergency access must:
- be time-bound
- have documented approval or retrospective approval within 1 business day
- be logged and reviewed after use

## Violations

Violations of this policy must be investigated and may result in removal of access, disciplinary action, or vendor offboarding as appropriate.
