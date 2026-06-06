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
const anonKey = requiredEnv('SUPABASE_PHASE0_ANON_KEY')
const token = requiredEnv('WORKOS_PHASE0_ACCESS_TOKEN')
const payload = decodeJwtPayload(token)

assert.equal(typeof payload.sub, 'string', 'token must include sub')
assert.equal(typeof payload.org_id, 'string', 'token must include org_id')

const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
  accessToken: async () => token,
})

const { data, error } = await supabase
  .from('workos_phase0_rls_probe')
  .select('id, workos_user_id, workos_org_id, visible_label')
  .order('id')

if (error) {
  throw new Error(`RLS probe failed: ${error.message}`)
}

assert.deepEqual(
  data.map(row => row.id),
  ['allowed'],
  'RLS must return only the matching row'
)
assert.equal(data[0].workos_user_id, payload.sub, 'returned row must match token sub')
assert.equal(data[0].workos_org_id, payload.org_id, 'returned row must match token org_id')

console.log(JSON.stringify({
  rows_visible: data.length,
  visible_ids: data.map(row => row.id),
  sub: payload.sub,
  org_id: payload.org_id,
}, null, 2))
