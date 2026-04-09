const fs = require('node:fs')
const path = require('node:path')

const repoRoot = process.cwd()

const requiredFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/security.yml',
  '.github/dependabot.yml',
  'tests/security/authorization-regression.test.mjs',
  'src/lib/monitoring.ts',
  'src/components/app/MonitoringBridge.tsx',
  'supabase/migrations/20260331_profile_role_lockdown.sql',
  'supabase/migrations/20260331_org_entity_admin_lockdown.sql',
  'supabase/migrations/20260331_security_definer_search_path.sql',
  'supabase/migrations/20260331_policy_upload_role_lockdown.sql',
  'supabase/migrations/20260331_org_alerts_lockdown.sql',
  'supabase/migrations/20260331_atomic_signup_onboarding.sql',
]

const contentChecks = [
  {
    file: 'package.json',
    includes: ['"test:security"', '"verify:guardrails"'],
  },
  {
    file: '.github/workflows/ci.yml',
    includes: ['npm run verify:guardrails', 'npm run test:security', 'npm run build'],
  },
  {
    file: '.github/workflows/security.yml',
    includes: ['npm audit --omit=dev --audit-level=high', 'dependency-review-action'],
  },
  {
    file: '.github/dependabot.yml',
    includes: ['package-ecosystem: "npm"', 'package-ecosystem: "github-actions"'],
  },
]

function fail(message) {
  console.error(`Security guardrail verification failed: ${message}`)
  process.exit(1)
}

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    fail(`missing required file ${relativePath}`)
  }
}

for (const check of contentChecks) {
  const absolutePath = path.join(repoRoot, check.file)
  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const snippet of check.includes) {
    if (!content.includes(snippet)) {
      fail(`expected ${check.file} to include: ${snippet}`)
    }
  }
}

console.log('Security guardrail verification passed.')
