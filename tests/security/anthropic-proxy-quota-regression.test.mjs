import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

const EDGE = 'supabase/functions/anthropic-proxy/index.ts'
const SQL = 'supabase/migrations/20260605185322_ai_proxy_token_budgets.sql'

test('Anthropic proxy enforces body and message-size bounds before quota or provider calls', () => {
  const ts = read(EDGE)

  assert.match(ts, /const MAX_REQUEST_BYTES\s*=/s)
  assert.match(ts, /const MAX_MESSAGES\s*=/s)
  assert.match(ts, /const MAX_MESSAGE_CONTENT_CHARS\s*=/s)
  assert.match(ts, /readLimitedJsonBody\(req\)/s)
  assert.match(ts, /content-length/s)
  assert.match(ts, /Request body too large/s)
  assert.match(ts, /messages\.length > MAX_MESSAGES/s)
  assert.match(ts, /content\.length > MAX_MESSAGE_CONTENT_CHARS/s)
  assert.match(ts, /system\.length > MAX_SYSTEM_CHARS/s)
})

test('Anthropic proxy reserves estimated input, output, and cost before forwarding', () => {
  const ts = read(EDGE)

  assert.match(ts, /estimateAnthropicInputTokens/s)
  assert.match(ts, /calculateCostMicros\(model as AllowedModel, estimatedInputTokens, reservedOutputTokens\)/s)
  assert.match(ts, /p_estimated_input_tokens:\s*estimatedInputTokens/s)
  assert.match(ts, /p_reserved_output_tokens:\s*reservedOutputTokens/s)
  assert.match(ts, /p_estimated_cost_micros:\s*estimatedCostMicros/s)
  assert.match(ts, /p_request_bytes:\s*bodySizeBytes/s)
  assert.match(ts, /usageLogId/s)
  assert.match(ts, /AI quota exceeded/s)
})

test('Anthropic proxy updates usage logs with provider-reported token usage', () => {
  const ts = read(EDGE)

  assert.match(ts, /const anthropicPayload = await anthropicRes\.json\(\)/s)
  assert.match(ts, /const actualUsage = parseAnthropicUsage\(anthropicPayload\)/s)
  assert.match(ts, /actualCostMicros/s)
  assert.match(ts, /\.from\('ai_usage_logs'\)[\s\S]*\.update\(\{[\s\S]*actual_input_tokens/s)
  assert.match(ts, /actual_output_tokens/s)
  assert.match(ts, /actual_cost_micros/s)
  assert.match(ts, /status: anthropicRes\.ok \? 'succeeded' : 'failed'/s)
})

test('AI usage migration adds token and cost budgets enforced by the quota RPC', () => {
  const sql = read(SQL)

  for (const column of [
    'request_bytes',
    'estimated_input_tokens',
    'reserved_output_tokens',
    'actual_input_tokens',
    'actual_output_tokens',
    'estimated_cost_micros',
    'actual_cost_micros',
    'status',
    'completed_at',
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, 's'), `${column} column is missing`)
  }

  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_ai_usage_org_time/s)
  assert.match(sql, /CREATE OR REPLACE FUNCTION check_and_log_ai_usage\(\s*p_model TEXT,\s*p_estimated_input_tokens INTEGER,\s*p_reserved_output_tokens INTEGER,\s*p_request_bytes INTEGER,\s*p_estimated_cost_micros BIGINT\s*\)/s)
  assert.match(sql, /RETURNS UUID/s)
  assert.match(sql, /v_user_daily_token_limit/s)
  assert.match(sql, /v_user_monthly_token_limit/s)
  assert.match(sql, /v_org_daily_token_limit/s)
  assert.match(sql, /v_org_monthly_token_limit/s)
  assert.match(sql, /v_user_daily_cost_micros/s)
  assert.match(sql, /v_user_monthly_cost_micros/s)
  assert.match(sql, /v_org_daily_cost_micros/s)
  assert.match(sql, /v_org_monthly_cost_micros/s)
  assert.match(sql, /pg_advisory_xact_lock/s)
  assert.match(sql, /COALESCE\(actual_input_tokens \+ actual_output_tokens, estimated_input_tokens \+ reserved_output_tokens\)/s)
  assert.match(sql, /COALESCE\(actual_cost_micros, estimated_cost_micros\)/s)
  assert.match(sql, /INSERT INTO ai_usage_logs[\s\S]*estimated_input_tokens[\s\S]*reserved_output_tokens[\s\S]*estimated_cost_micros/s)
  assert.match(sql, /DROP FUNCTION IF EXISTS check_and_log_ai_usage\(TEXT\)/s)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION check_and_log_ai_usage\(TEXT, INTEGER, INTEGER, INTEGER, BIGINT\) TO authenticated/s)
})
