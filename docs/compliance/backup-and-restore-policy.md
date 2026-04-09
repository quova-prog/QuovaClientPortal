# Backup and Restore Policy

- Version: Draft 1.0
- Control owner: Infrastructure / Operations Lead
- Review cadence: At least annually
- Last updated: 2026-03-31

## Purpose

This policy defines requirements for backup coverage, restore testing, recovery objectives, and evidence retention.

## Scope

Systems requiring backup and recovery planning:
- Supabase PostgreSQL data
- audit log data
- application source code
- deployment configuration
- critical compliance documents and operational runbooks

## Requirements

- Production data backups must be enabled for the primary database service.
- Backup configuration changes must be reviewed and documented.
- Restore procedures must be documented and accessible to approved operators.
- Backup access must be limited to authorized personnel.

## Recovery Objectives

Define and approve:
- Recovery Time Objective (RTO)
- Recovery Point Objective (RPO)

Until formally approved, use provisional targets and document them in the restoration evidence record.

## Restore Testing

Restore testing must occur at least annually, and preferably quarterly for the primary database.

Each restore test should document:
- date and environment
- initiator and reviewer
- backup source and time
- restoration success/failure
- measured RTO/RPO outcomes
- follow-up remediation items

## Evidence

Retain:
- backup configuration screenshots or exports
- provider backup status evidence
- restore test records
- approvals for any exceptions
