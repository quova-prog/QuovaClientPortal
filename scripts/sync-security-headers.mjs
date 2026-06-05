import { readFile, writeFile } from 'node:fs/promises'

const sourcePath = new URL('../config/security-headers.json', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)
const publicHeadersPath = new URL('../public/_headers', import.meta.url)

const source = JSON.parse(await readFile(sourcePath, 'utf8'))
if (!Array.isArray(source.headers)) {
  throw new Error('config/security-headers.json must contain a headers array')
}

const vercelConfig = {
  rewrites: [
    {
      source: '/((?!assets/).*)',
      destination: '/index.html',
    },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: source.headers,
    },
  ],
}

const staticHeaders = [
  '/*',
  ...source.headers.map(({ key, value }) => `  ${key}: ${value}`),
  '',
].join('\n')

await writeFile(vercelPath, `${JSON.stringify(vercelConfig, null, 2)}\n`)
await writeFile(publicHeadersPath, staticHeaders)

console.log('Synced security headers to vercel.json and public/_headers')
