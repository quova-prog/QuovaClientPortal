#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const roots = ['src', 'supabase/functions', 'supabase/migrations', 'tests']
const outputPath = 'docs/workos/identity-callsite-inventory.json'

const patterns = [
  { key: 'auth_uid', pattern: 'auth\\.uid\\(\\)' },
  { key: 'aal_or_mfa', pattern: "auth\\.jwt\\(\\)->>'aal'|aal2|authenticateUserAal2|getAuthenticatorAssuranceLevel|Supabase MFA|mfa" },
  { key: 'supabase_auth', pattern: 'supabase\\.auth\\.|auth\\.users|Session|User' },
  { key: 'invite_flow', pattern: 'accept_invite|send-team-invite|invites|AcceptInvitePage|teamInviteEmail' },
  { key: 'support_identity', pattern: 'support_users|is_support_user|has_support_access_to|support_write_audit_log' },
  { key: 'audit_identity', pattern: 'write_audit_log|audit_trigger_func|enforce_audit_log_fields|audit_logs' },
]

function runRg(pattern) {
  try {
    return execFileSync('rg', ['-n', pattern, ...roots, '-g', '!deno.lock'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (error.status === 1) return ''
    throw error
  }
}

function classifyFile(file) {
  if (file.startsWith('supabase/migrations/')) return 'migration'
  if (file.startsWith('supabase/functions/')) return 'edge-function'
  if (file.startsWith('src/')) return 'frontend'
  if (file.startsWith('tests/')) return 'test'
  return 'other'
}

function parseLine(rawLine) {
  const first = rawLine.indexOf(':')
  const second = rawLine.indexOf(':', first + 1)
  const file = rawLine.slice(0, first)
  const line = Number(rawLine.slice(first + 1, second))
  const text = rawLine.slice(second + 1).trim()
  return {
    file,
    line,
    category: classifyFile(file),
    text,
  }
}

const inventory = {
  generated_at: new Date().toISOString(),
  roots,
  patterns: {},
  summary: {},
}

for (const { key, pattern } of patterns) {
  const raw = runRg(pattern)
  const entries = raw
    .split('\n')
    .filter(Boolean)
    .map(parseLine)

  inventory.patterns[key] = entries
  inventory.summary[key] = {
    matches: entries.length,
    files: [...new Set(entries.map(entry => entry.file))].sort().length,
    by_category: entries.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + 1
      return acc
    }, {}),
  }
}

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`)

console.log(JSON.stringify(inventory.summary, null, 2))
console.log(`Wrote ${outputPath}`)
