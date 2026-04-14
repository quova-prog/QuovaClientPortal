// ============================================================
// Crypto helpers for secure tokens using JWT
// ============================================================

import { SignJWT, jwtVerify } from 'https://esm.sh/jose@4.14.4'

function getSecretKey(): Uint8Array {
  const secretStr = Deno.env.get('UNSUBSCRIBE_SECRET')
  if (!secretStr) {
    throw new Error('CRITICAL: UNSUBSCRIBE_SECRET environment variable is not defined. Failing closed to prevent insecure tokens.')
  }
  return new TextEncoder().encode(secretStr)
}

/**
 * Creates a signed JWT for unsusbscribe tokens.
 */
export async function signUnsubscribeToken(payload: { user_id: string; pref: string }, expiresInMs: number): Promise<string> {
  const secretKey = getSecretKey()
  
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1000))
    .sign(secretKey)
}

/**
 * Verifies and decodes an unsubscribe token.
 */
export async function verifyUnsubscribeToken(token: string): Promise<{ user_id: string; pref: string } | null> {
  try {
    const secretKey = getSecretKey()
    const { payload } = await jwtVerify(token, secretKey)
    return payload as { user_id: string; pref: string }
  } catch (err) {
    console.error('Token verification failed:', err)
    return null
  }
}
