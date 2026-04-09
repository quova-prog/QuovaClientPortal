# Vendor Management Policy

- Version: Draft 1.0
- Control owner: Operations / Security
- Review cadence: At least annually
- Last updated: 2026-03-31

## Purpose

This policy defines how Orbit identifies, assesses, approves, reviews, and offboards vendors and subservice organizations.

## Scope

This policy applies to vendors that:
- host production systems
- store or process customer data
- support source control, CI/CD, monitoring, or operations
- deliver security-sensitive functionality

## Current Vendor Inventory (Repo-Based)

Vendors inferred from repo:
- Supabase
- Vercel
- GitHub
- npm package ecosystem
- configured monitoring endpoint provider, if used

This inventory must be expanded with all production vendors before audit fieldwork.

## Initial Review Requirements

Before onboarding a material vendor:
- document services provided
- classify data shared or stored
- identify business owner
- review security/compliance documentation where available
- record contractual/security expectations

## Annual Review Requirements

Annual review should verify:
- vendor remains necessary
- security/compliance materials remain acceptable
- vendor incidents or outages have been reviewed
- access and data-sharing scope is still appropriate

## Offboarding

When a vendor is removed:
- revoke credentials and integrations
- remove secrets and tokens
- document data retention or deletion obligations
- update the vendor inventory
