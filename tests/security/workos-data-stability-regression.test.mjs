import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function functionBody(source, name) {
  const start = source.indexOf(`export function ${name}`)
  assert.notEqual(start, -1, `${name} should exist`)
  const next = source.indexOf('\nexport function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('FX exposure hook exits loading when auth org context is temporarily unavailable', () => {
  const useData = readRepoFile('src/hooks/useData.ts')
  const useExposures = functionBody(useData, 'useExposures')

  assert.match(useExposures, /if \(!user\?\.profile\?\.org_id\) \{ setLoading\(false\); return \}/s)
})

test('dashboard source hooks preserve previous rows when Supabase returns an auth/query error', () => {
  const useData = readRepoFile('src/hooks/useData.ts')

  for (const [name, setter] of [
    ['useExposureSummary', 'setSummary'],
    ['useHedgePositions', 'setPositions'],
    ['useHedgeCoverage', 'setCoverage'],
    ['useUploadBatches', 'setBatches'],
  ]) {
    const body = functionBody(useData, name)
    assert.match(body, /const \{ data, error \} = await/s, `${name} should inspect Supabase query errors`)
    assert.match(body, /if \(error\) \{ setLoading\(false\); return \}/s, `${name} should not overwrite state on errors`)
    assert.match(body, new RegExp(`else ${setter}\\(data \\?\\? \\[\\]\\)`, 's'), `${name} should update rows only on successful queries`)
  }
})
