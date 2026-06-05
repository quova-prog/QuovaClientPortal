// ============================================================
// Orbit Edge Function: send-team-invite
// Sends an organization invite email for pending team invites
// ============================================================
import { createAdminClient, authenticateUserAal2, jsonResponse, corsHeaders } from '../_shared/auth.ts';
import { sendEmail } from '../_shared/sendgrid.ts';
import { teamInviteEmail } from '../_shared/emailTemplates.ts';
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://app.quovaos.com';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req)
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse({
      error: 'Method not allowed'
    }, 405);
  }
  const auth = await authenticateUserAal2(req);
  if (!auth.authenticated) {
    return jsonResponse({
      error: auth.error ?? 'Unauthorized'
    }, 401, req);
  }
  let body;
  try {
    body = await req.json();
  } catch  {
    return jsonResponse({
      error: 'Invalid JSON body'
    }, 400);
  }
  if (!body.invite_id) {
    return jsonResponse({
      error: 'Missing invite_id'
    }, 400);
  }
  const admin = createAdminClient();
  const { data: invite, error: inviteErr } = await admin.from('invites').select('id, org_id, email, role, invited_by, accepted_at, expires_at').eq('id', body.invite_id).single();
  if (inviteErr || !invite) {
    return jsonResponse({
      error: 'Invite not found'
    }, 404);
  }
  const { data: callerProfile } = await admin.from('profiles').select('org_id, role').eq('id', auth.user.id).single();
  if (callerProfile?.org_id !== invite.org_id || callerProfile.role !== 'admin') {
    return jsonResponse({
      error: 'Forbidden: Admin access required for this organization'
    }, 403);
  }
  if (invite.invited_by !== auth.user.id) {
    return jsonResponse({
      error: 'Forbidden: Only the inviter can send this invite email'
    }, 403);
  }
  if (invite.accepted_at) {
    return jsonResponse({
      error: 'Invite has already been accepted'
    }, 409);
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return jsonResponse({
      error: 'Invite has expired'
    }, 410);
  }
  const { data: org } = await admin.from('organisations').select('name').eq('id', invite.org_id).single();
  if (!org) {
    return jsonResponse({
      error: 'Organization not found'
    }, 404);
  }
  const inviteUrl = `${APP_BASE_URL}/accept-invite?invite=${encodeURIComponent(invite.id)}`;
  const emailContent = teamInviteEmail({
    orgName: org.name,
    inviterEmail: auth.user.email ?? 'An Orbit administrator',
    role: invite.role,
    inviteUrl
  });
  const result = await sendEmail({
    to: invite.email,
    subject: emailContent.subject,
    html: emailContent.html
  });
  await admin.from('email_logs').insert({
    org_id: invite.org_id,
    user_id: auth.user.id,
    email_type: 'team_invite',
    recipient: invite.email,
    subject: emailContent.subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.error ?? null
  });
  if (!result.ok) {
    return jsonResponse({
      error: result.error ?? 'SendGrid rejected the invite email'
    }, 502);
  }
  return jsonResponse({
    message: 'Invite email sent',
    invite_id: invite.id
  }, 200);
});
