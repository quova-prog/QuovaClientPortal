# Incident Response Policy

- Version: Draft 1.0
- Control owner: Security Lead
- Review cadence: At least annually and after material incidents
- Last updated: 2026-03-31

## Purpose

This policy defines how Orbit identifies, escalates, investigates, contains, communicates, and closes security and availability incidents.

## Incident Categories

Examples:
- unauthorized access or suspected compromise
- production data exposure
- RLS or authorization bypass
- monitoring alerts indicating repeated abuse
- service outage or degraded availability
- failed or incomplete recovery from backup/restore activity

## Severity Guidance

- `SEV-1`: confirmed breach, major data exposure, or prolonged production outage
- `SEV-2`: serious security weakness or significant customer-facing degradation
- `SEV-3`: contained issue with limited impact
- `SEV-4`: low-impact event or suspicious activity requiring review

## Response Workflow

1. Triage and assign severity.
2. Preserve evidence.
3. Contain active risk.
4. Notify internal responders.
5. Investigate scope, timeline, and affected assets.
6. Remediate and recover.
7. Notify customers or stakeholders where required.
8. Complete post-incident review and corrective actions.

## Evidence Preservation

Retain where applicable:
- audit log records
- monitoring events
- deployment and CI records
- screenshots or console output relevant to impact
- database or vendor logs
- timeline of actions taken

## Communications

Internal communications must identify:
- severity
- owner
- systems affected
- current status
- next update time

Customer or external communications must be approved by an authorized owner before release.

## Post-Incident Review

Each material incident requires:
- root cause summary
- impact summary
- timeline
- controls that failed or succeeded
- corrective actions with owners and due dates
