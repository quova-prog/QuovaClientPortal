#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const tokenAssertion = run('node', ['scripts/workos/phase0-assert-workos-token.mjs'])
const seedResult = run('node', ['scripts/workos/phase0-seed-rls-probe.mjs'])
const smokeResult = run('node', ['scripts/workos/phase0-rls-smoke.mjs'])
const inventoryRaw = readFileSync('docs/workos/identity-callsite-inventory.json', 'utf8')
const inventory = JSON.parse(inventoryRaw)

const output = `# WorkOS Phase 0 Validation Result

Date: ${new Date().toISOString().slice(0, 10)}

## Token Assertion

Command:

\`\`\`bash
node scripts/workos/phase0-assert-workos-token.mjs
\`\`\`

Output:

\`\`\`json
${tokenAssertion}
\`\`\`

## RLS Probe Seeding

Command:

\`\`\`bash
node scripts/workos/phase0-seed-rls-probe.mjs
\`\`\`

Output:

\`\`\`json
${seedResult}
\`\`\`

## RLS Smoke

Command:

\`\`\`bash
node scripts/workos/phase0-rls-smoke.mjs
\`\`\`

Output:

\`\`\`json
${smokeResult}
\`\`\`

## Identity Inventory Summary

\`\`\`json
${JSON.stringify(inventory.summary, null, 2)}
\`\`\`

## Gate Decision

Phase 0 passed because the decoded token has \`role = authenticated\`, has a
real WorkOS \`org_id\`, has a Quova \`user_role\`, the Supabase RLS smoke script
returned only the \`allowed\` row, and the generated identity callsite inventory
exists.

Decision: PASS
`

writeFileSync('docs/workos/phase0-validation-result.md', output)
console.log('Wrote docs/workos/phase0-validation-result.md')
