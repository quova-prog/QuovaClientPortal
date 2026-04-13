// ============================================================
// SendGrid REST API wrapper for Deno Edge Functions
// ============================================================

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'

export interface SendGridEmail {
  to: string
  toName?: string
  subject: string
  html: string
  /** Base64-encoded attachment */
  attachment?: {
    content: string
    filename: string
    type: string
  }
}

export interface SendGridResult {
  ok: boolean
  statusCode: number
  error?: string
}

export async function sendEmail(email: SendGridEmail): Promise<SendGridResult> {
  const apiKey = Deno.env.get('SENDGRID_API_KEY')
  if (!apiKey) {
    return { ok: false, statusCode: 500, error: 'SENDGRID_API_KEY not configured' }
  }

  const fromEmail = Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'alerts@quovaos.com'
  const fromName = Deno.env.get('EMAIL_FROM_NAME') ?? 'Quova'

  const personalizations = [{
    to: [{ email: email.to, name: email.toName }],
  }]

  const message: Record<string, unknown> = {
    personalizations,
    from: { email: fromEmail, name: fromName },
    subject: email.subject,
    content: [{ type: 'text/html', value: email.html }],
  }

  if (email.attachment) {
    message.attachments = [{
      content: email.attachment.content,
      filename: email.attachment.filename,
      type: email.attachment.type,
      disposition: 'attachment',
    }]
  }

  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, statusCode: res.status }
    }

    const body = await res.text()
    return { ok: false, statusCode: res.status, error: body }
  } catch (err) {
    return { ok: false, statusCode: 0, error: String(err) }
  }
}
