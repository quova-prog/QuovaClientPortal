import { supabase, supabaseUrl } from './supabase'

interface AnthropicProxyRequest {
  model: string
  max_tokens: number
  messages: Array<{ role: string; content: string }>
  system?: string
  temperature?: number
}

export async function callAnthropicProxy(body: AnthropicProxyRequest): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }

  return fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
