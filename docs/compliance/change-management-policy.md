# Change Management Policy

- Version: Draft 1.0
- Control owner: Engineering Lead
- Review cadence: At least annually
- Last updated: 2026-03-31

## Purpose

This policy defines how code, infrastructure, database, and configuration changes are developed, reviewed, tested, approved, and deployed.

## Scope

This policy applies to:
- application code
- SQL migrations
- CI workflows
- security headers and deployment configuration
- monitoring configuration
- production environment variables and secrets

## Standard Change Requirements

Every production change must have:
- a tracked change record or pull request
- a clear description of the change and expected impact
- reviewer approval from an authorized maintainer
- evidence of testing appropriate to the risk level

Minimum engineering controls:
- CI must pass before merge
- security regression checks must pass before merge
- production builds must succeed before release
- security-sensitive migration files must remain present

## Database Changes

Database changes must:
- be implemented through versioned SQL migrations in `supabase/migrations/`
- include RLS and authorization review when security boundaries are affected
- include regression test updates when role or policy behavior changes
- be applied in production using an approved release process

## Emergency Changes

Emergency changes are allowed only when needed to:
- restore service
- mitigate active security risk
- prevent material customer impact

Emergency changes must:
- be documented immediately
- receive retrospective review within 1 business day
- include root cause and follow-up actions

## Separation of Duties

Where team size permits:
- the change author should not be the sole approver
- production deployment approval should be separate from implementation
- security-sensitive changes should receive explicit security review

## Evidence

Retain:
- pull request links
- approvals
- CI results
- deployment records
- rollback records when used
- post-incident or retrospective notes when applicable
