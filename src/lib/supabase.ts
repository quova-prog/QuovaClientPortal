import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Copy .env.example to .env.local and fill in your Supabase URL and anon key.'
  )
}

export type SupabaseAccessTokenProvider = () => Promise<string | null>

let supabaseAccessTokenProvider: SupabaseAccessTokenProvider | null = null

function createOrbitSupabaseClient(
  accessTokenProvider: SupabaseAccessTokenProvider | null = null,
): SupabaseClient<Database> {
  if (accessTokenProvider) {
    return createClient<Database>(supabaseUrl, supabaseAnonKey, {
      accessToken: accessTokenProvider,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }

  // detectSessionInUrl is intentionally TRUE here (and FALSE in the
  // support portal). The customer-facing app needs the Supabase client
  // to auto-consume access_token fragments from URLs delivered via:
  //   - Email confirmation links (signup)
  //   - Password reset links (forgot-password)
  // Without it, those flows would land the user on the page but leave
  // them unauthenticated. The support portal has no signup/OAuth flow,
  // so it correctly leaves this off as defense-in-depth — a deliberate
  // asymmetry, not a bug. If a recovery link issued for the customer
  // app is ever clicked from the support portal (or vice versa), the
  // support portal will simply ignore the token; the user will need
  // to click the link from the correct portal.
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export let supabase = createOrbitSupabaseClient()

export function setSupabaseAccessTokenProvider(provider: SupabaseAccessTokenProvider | null): void {
  supabaseAccessTokenProvider = provider
  supabase = createOrbitSupabaseClient(supabaseAccessTokenProvider)
}

export { supabaseUrl }
export type { User, Session } from '@supabase/supabase-js'
