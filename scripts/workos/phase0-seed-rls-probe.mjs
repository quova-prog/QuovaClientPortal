#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

const supabaseUrl = requiredEnv('SUPABASE_PHASE0_URL')
const serviceRoleKey = requiredEnv('SUPABASE_PHASE0_SERVICE_ROLE_KEY')
const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const payload = decodeJwtPayload(token)

assert.equal(typeof payload.sub, 'string', 'token must include sub')
assert.equal(typeof payload.org_id, 'string', 'token must include org_id')

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

const rows = [
  {
    id: 'allowed',
    workos_user_id: payload.sub,
    workos_org_id: payload.org_id,
    visible_label: 'allowed row for matching WorkOS sub and org',
  },
  {
    id: 'wrong-org',
    workos_user_id: payload.sub,
    workos_org_id: 'org_phase0_wrong',
    visible_label: 'row with matching user and wrong org',
  },
  {
    id: 'wrong-user',
    workos_user_id: 'user_phase0_wrong',
    workos_org_id: payload.org_id,
    visible_label: 'row with wrong user and matching org',
  },
]

const { data, error } = await admin
  .from('workos_phase0_rls_probe')
  .upsert(rows, { onConflict: 'id' })
  .select('id, workos_user_id, workos_org_id, visible_label')
  .order('id')

if (error) {
  throw new Error(`Failed to seed probe rows: ${error.message}`)
}

console.log(JSON.stringify(data, null, 2))
