import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { loadRuntimeWorkosAuthConfig } from '@/lib/workosConfig'

export interface TeamMember {
  id: string
  full_name: string | null
  email: string
  role: 'admin' | 'editor' | 'viewer'
  created_at: string
}

export interface Invite {
  id: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
  invited_by: string
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export function useTeamMembers() {
  const { user, db } = useAuth()
  const config = loadRuntimeWorkosAuthConfig()
  const isWorkos = config.provider === 'workos'
  const orgId = user?.profile?.org_id
  const isAdmin = user?.profile?.role === 'admin'

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !isAdmin) { setLoading(false); return }
    setLoading(true)
    setError(null)

    // Fetch members (profiles with org-scoped RLS)
    const { data: profiles, error: profilesErr } = await db
      .from('profiles')
      .select('id, full_name, email, role, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })

    if (profilesErr) {
      if (!profilesErr.message.includes('permission')) {
        setError(profilesErr.message)
      }
      setLoading(false)
      return
    }

    const memberList: TeamMember[] = (profiles ?? []).map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.id === user?.id ? (user?.email ?? p.email ?? '') : (p.email ?? ''),
      role: p.role,
      created_at: p.created_at,
    }))

    setMembers(memberList)

    if (isWorkos) {
      const { data: inviteResult, error: inviteErr } = await db.functions.invoke('workos-team-invites', {
        body: { action: 'list' },
      })
      if (!inviteErr && Array.isArray(inviteResult?.invites)) {
        setInvites(inviteResult.invites as Invite[])
      }
    } else {
      // Fetch pending invites
      const { data: inviteData, error: inviteErr } = await db
        .from('invites')
        .select('*')
        .eq('org_id', orgId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false })

      if (!inviteErr) {
        setInvites((inviteData ?? []) as Invite[])
      }
    }

    setLoading(false)
  }, [orgId, isAdmin, isWorkos, db, user?.id, user?.email])

  useEffect(() => { load() }, [load])

  async function invite(email: string, role: 'admin' | 'editor' | 'viewer'): Promise<{ error?: string }> {
    if (!orgId || !isAdmin) return { error: 'Admin access required' }

    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return { error: 'Invalid email address' }

    // Check for existing member with same email
    const existingMember = members.find(m => m.email.toLowerCase() === trimmed)
    if (existingMember) return { error: 'This user is already a member of your organization' }

    // Check for existing pending invite
    const existingInvite = invites.find(i => i.email.toLowerCase() === trimmed)
    if (existingInvite) return { error: 'An invite has already been sent to this email' }

    if (isWorkos) {
      const { data: inviteResult, error: inviteErr } = await db.functions.invoke('workos-team-invites', {
        body: { action: 'send', email: trimmed, role },
      })
      if (inviteErr || inviteResult?.error) {
        return { error: inviteErr?.message ?? inviteResult?.error ?? 'Invite email could not be sent' }
      }
      await load()
      return {}
    }

    const { data: newInvite, error: insertErr } = await db
      .from('invites')
      .insert({
        org_id: orgId,
        email: trimmed,
        role,
        invited_by: user!.id,
      })
      .select('id')
      .single()

    if (insertErr) {
      if (insertErr.message.includes('duplicate')) {
        return { error: 'An invite already exists for this email' }
      }
      return { error: insertErr.message }
    }

    const { data: emailResult, error: emailErr } = await db.functions.invoke('send-team-invite', {
      body: { invite_id: newInvite.id },
    })

    if (emailErr || emailResult?.error) {
      await db.from('invites').delete().eq('id', newInvite.id)
      return { error: emailErr?.message ?? emailResult?.error ?? 'Invite email could not be sent' }
    }

    await load()
    return {}
  }

  async function revokeInvite(inviteId: string): Promise<{ error?: string }> {
    if (!isAdmin) return { error: 'Admin access required' }

    if (isWorkos) {
      const { data: inviteResult, error: revokeErr } = await db.functions.invoke('workos-team-invites', {
        body: { action: 'revoke', invitation_id: inviteId },
      })
      if (revokeErr || inviteResult?.error) {
        return { error: revokeErr?.message ?? inviteResult?.error ?? 'Invite could not be revoked' }
      }
      await load()
      return {}
    }

    const { error: deleteErr } = await db
      .from('invites')
      .delete()
      .eq('id', inviteId)

    if (deleteErr) return { error: deleteErr.message }

    await load()
    return {}
  }

  async function updateRole(targetUserId: string, newRole: 'admin' | 'editor' | 'viewer'): Promise<{ error?: string }> {
    if (!isAdmin) return { error: 'Admin access required' }

    const { error: rpcErr } = await db.rpc('update_member_role', {
      p_target_user_id: targetUserId,
      p_new_role: newRole,
    })

    if (rpcErr) return { error: rpcErr.message }

    await load()
    return {}
  }

  async function removeMember(targetUserId: string): Promise<{ error?: string }> {
    if (!isAdmin) return { error: 'Admin access required' }

    const { error: rpcErr } = await db.rpc('remove_member', {
      p_target_user_id: targetUserId,
    })

    if (rpcErr) return { error: rpcErr.message }

    await load()
    return {}
  }

  return {
    members,
    invites,
    loading,
    error,
    isAdmin,
    invite,
    revokeInvite,
    updateRole,
    removeMember,
    reload: load,
  }
}
