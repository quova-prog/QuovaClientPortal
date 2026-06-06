#!/usr/bin/env node
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'

const ENV_FILE = '.env.phase0.local'
const DEFAULT_REDIRECT_URI = 'http://localhost:8787/callback'

function parseEnvFile(path) {
  if (!existsSync(path)) return {}

  const entries = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = rawLine.indexOf('=')
    if (separator === -1) continue

    const key = rawLine.slice(0, separator).trim()
    let value = rawLine.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries[key] = value
  }
  return entries
}

function envValue(env, name) {
  const value = process.env[name] ?? env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function updateEnvFile(path, key, value) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : []
  let replaced = false
  const nextLines = lines.map(line => {
    if (line.startsWith(`${key}=`)) {
      replaced = true
      return `${key}=${value}`
    }
    return line
  })

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('')
    }
    nextLines.push(`${key}=${value}`)
  }

  writeFileSync(path, `${nextLines.filter((line, index, arr) => {
    return index < arr.length - 1 || line !== ''
  }).join('\n')}\n`)
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'token must have three JWT parts')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body, null, 2))
}

async function exchangeCode({ apiKey, clientId, code, request }) {
  const response = await fetch('https://api.workos.com/user_management/authenticate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: apiKey,
      code,
      ip_address: request.socket.remoteAddress,
      user_agent: request.headers['user-agent'],
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      `WorkOS code exchange failed (${response.status}): ${data.message || data.error_description || data.error || 'unknown error'}`
    )
  }

  assert.equal(typeof data.access_token, 'string', 'WorkOS response must include access_token')
  return data.access_token
}

const env = parseEnvFile(ENV_FILE)
const clientId = envValue(env, 'WORKOS_CLIENT_ID')
const apiKey = envValue(env, 'WORKOS_API_KEY')
const expectedOrgId = envValue(env, 'WORKOS_PHASE0_EXPECTED_ORG_ID')
const invitationToken = process.env.WORKOS_PHASE0_INVITATION_TOKEN?.trim() || env.WORKOS_PHASE0_INVITATION_TOKEN
const redirectUri = process.env.WORKOS_PHASE0_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI
const state = randomBytes(24).toString('base64url')

const authorizationUrl = new URL('https://api.workos.com/user_management/authorize')
authorizationUrl.searchParams.set('provider', 'authkit')
authorizationUrl.searchParams.set('client_id', clientId)
authorizationUrl.searchParams.set('redirect_uri', redirectUri)
authorizationUrl.searchParams.set('response_type', 'code')
authorizationUrl.searchParams.set('organization_id', expectedOrgId)
authorizationUrl.searchParams.set('state', state)
if (invitationToken) {
  authorizationUrl.searchParams.set('invitation_token', invitationToken)
}

const redirectUrl = new URL(redirectUri)
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', redirectUri)
    if (requestUrl.pathname !== redirectUrl.pathname) {
      jsonResponse(response, 404, { error: 'not_found' })
      return
    }

    const returnedState = requestUrl.searchParams.get('state')
    assert.equal(returnedState, state, 'callback state did not match')

    const code = requestUrl.searchParams.get('code')
    assert.equal(typeof code, 'string', 'callback must include code')

    const accessToken = await exchangeCode({ apiKey, clientId, code, request })
    const payload = decodeJwtPayload(accessToken)

    assert.equal(payload.org_id, expectedOrgId, 'access token org_id must match WORKOS_PHASE0_EXPECTED_ORG_ID')
    assert.equal(payload.role, 'authenticated', 'access token role must be authenticated')
    assert.equal(typeof payload.user_role, 'string', 'access token must include user_role')

    updateEnvFile(ENV_FILE, 'WORKOS_PHASE0_ACCESS_TOKEN', accessToken)

    const summary = {
      saved: 'WORKOS_PHASE0_ACCESS_TOKEN',
      sub: payload.sub,
      org_id: payload.org_id,
      role: payload.role,
      user_role: payload.user_role,
      sid: payload.sid,
      exp: payload.exp,
    }

    jsonResponse(response, 200, {
      ok: true,
      message: `Saved WORKOS_PHASE0_ACCESS_TOKEN to ${ENV_FILE}`,
      summary,
    })
    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    jsonResponse(response, 500, { ok: false, error: message })
    console.error(message)
  } finally {
    server.close()
  }
})

server.listen(Number(redirectUrl.port), redirectUrl.hostname, () => {
  console.log(`Listening on ${redirectUri}`)
  console.log('Open this URL and complete the AuthKit login:')
  console.log(authorizationUrl.toString())
})
