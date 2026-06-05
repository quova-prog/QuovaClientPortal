import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const SQL = 'supabase/migrations/20260604000009_settle_expired_windows_cron.sql'

test('Cron: settle-expired-windows scheduled daily via pg_cron + pg_net', () => {
  const sql = read(SQL)
  assert.match(sql, /cron\.schedule\(\s*'settle-expired-windows'/s)
  // daily schedule (run once per day, not hourly)
  assert.match(sql, /'0 \d+ \* \* \*'/s)
  // invokes the deployed Edge Function with the service-role key from app settings
  assert.match(sql, /\/functions\/v1\/settle-expired-windows/s)
  assert.match(sql, /current_setting\('app\.settings\.service_role_key', true\)/s)
})
