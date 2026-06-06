import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const authkitFiles = [
  'node_modules/@workos-inc/authkit-js/dist/index.mjs',
  'node_modules/@workos-inc/authkit-js/dist/index.js',
]

const helperAnchor = `  authenticationMethod: "workos:authentication-method"
};
`

const helper = `  authenticationMethod: "workos:authentication-method"
};

function readQuovaWorkosInvitationToken() {
  if (typeof window === "undefined" || !window.sessionStorage) return void 0;
  try {
    const raw = window.sessionStorage.getItem("quova:workos-invitation-token");
    if (!raw) return void 0;
    const parsed = JSON.parse(raw);
    const token = typeof parsed?.token === "string" ? parsed.token.trim() : "";
    return token || void 0;
  } catch {
    return void 0;
  }
}
`

const replacements = [
  {
    description: 'extend authenticateWithCode args',
    before: `  async authenticateWithCode({
    code,
    codeVerifier,
    useCookie
  }) {`,
    after: `  async authenticateWithCode({
    code,
    codeVerifier,
    invitationToken,
    useCookie
  }) {`,
  },
  {
    description: 'forward invitation token to authenticate endpoint',
    before: `        grant_type: "authorization_code",
        code_verifier: codeVerifier
      }`,
    after: `        grant_type: "authorization_code",
        code_verifier: codeVerifier,
        invitation_token: invitationToken
      }`,
  },
  {
    description: 'read remembered invitation token before callback exchange',
    before: `  const codeVerifier = window.sessionStorage.getItem(
    storageKeys.codeVerifier
  );
  if (code) {`,
    after: `  const codeVerifier = window.sessionStorage.getItem(
    storageKeys.codeVerifier
  );
  const invitationToken = readQuovaWorkosInvitationToken();
  if (code) {`,
  },
  {
    description: 'pass remembered invitation token into code exchange',
    before: `            code,
            codeVerifier,
            useCookie: __privateGet(this, _Client_instances, useCookie_get)
          })`,
    after: `            code,
            codeVerifier,
            invitationToken,
            useCookie: __privateGet(this, _Client_instances, useCookie_get)
          })`,
  },
]

function replaceOnce(content, { before, after, description }, file) {
  if (content.includes(after)) return content
  if (!content.includes(before)) {
    throw new Error(`Could not apply AuthKit patch step "${description}" to ${file}`)
  }
  return content.replace(before, after)
}

for (const relativeFile of authkitFiles) {
  const file = path.join(repoRoot, relativeFile)
  if (!existsSync(file)) {
    console.warn(`[patch-authkit-invitation-token] ${relativeFile} not found; skipping`)
    continue
  }

  let content = readFileSync(file, 'utf8')
  if (!content.includes('function readQuovaWorkosInvitationToken()')) {
    if (!content.includes(helperAnchor)) {
      throw new Error(`Could not insert AuthKit invitation token helper into ${relativeFile}`)
    }
    content = content.replace(helperAnchor, helper)
  }

  for (const replacement of replacements) {
    content = replaceOnce(content, replacement, relativeFile)
  }

  writeFileSync(file, content)
  console.log(`[patch-authkit-invitation-token] patched ${relativeFile}`)
}
