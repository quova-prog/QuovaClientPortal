import { useState } from 'react'
import { Check, X, Edit2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { ORBIT_TARGET_FIELDS } from '@/lib/discoveryService'
import { VerdictBadge } from '@/components/onboarding/VerdictBadge'
import { SignalBreakdown } from '@/components/onboarding/SignalBreakdown'
import type { FieldMapping } from '@/types'

interface MappingRowProps {
  mapping:         FieldMapping
  onConfirm:       () => void
  onReject:        () => void
  onEdit:          (newField: string) => void
  onReset:         () => void
}

export function MappingRow({
  mapping, onConfirm, onReject, onEdit, onReset,
}: MappingRowProps): React.ReactElement {
  const [editing,   setEditing]   = useState(false)
  const [editValue, setEditValue] = useState(mapping.target_field)
  const [expanded,  setExpanded]  = useState(false)

  const pct = Math.round(mapping.confidence * 100)
  const confColor = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)'
  const hasReconciliation = !!mapping.verdict

  const StatusBadge = () => ({
    proposed:  <span className="badge badge-gray"  style={{ fontSize: '0.68rem' }}>Pending</span>,
    confirmed: <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>✓ Confirmed</span>,
    rejected:  <span className="badge badge-red"   style={{ fontSize: '0.68rem' }}>✗ Rejected</span>,
    modified:  <span className="badge badge-teal"  style={{ fontSize: '0.68rem' }}>✎ Modified</span>,
  }[mapping.status])

  return (
    <>
      <tr style={{ opacity: mapping.status === 'rejected' ? 0.45 : 1 }}>

        {/* Source field */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {hasReconciliation && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                title={expanded ? 'Hide details' : 'Show details'}
              >
                {expanded
                  ? <ChevronDown size={12} color="var(--text-muted)" />
                  : <ChevronRight size={12} color="var(--text-muted)" />}
              </button>
            )}
            <div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {mapping.source_table}.
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {mapping.source_field}
              </span>
            </div>
          </div>
        </td>

        {/* Arrow */}
        <td style={{ padding: '0.6rem 0.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '1rem' }}>→</td>

        {/* Target field */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          {editing ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                className="input"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '3px 6px', height: 28 }}
              >
                {ORBIT_TARGET_FIELDS.map(f => (
                  <option key={f.field} value={f.field}>{f.label}</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => { onEdit(editValue); setEditing(false) }}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--teal-dark)' }}>
              exposure.<strong>{mapping.target_field}</strong>
            </span>
          )}
        </td>

        {/* Sample values */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {(Array.isArray(mapping.sample_values) ? mapping.sample_values : [])
              .slice(0, 3)
              .map((v, i) => (
                <span key={i} className="badge badge-gray"
                  style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {String(v)}
                </span>
              ))}
          </div>
        </td>

        {/* Confidence + Verdict */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 44, height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: confColor, borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: confColor }}>{pct}%</span>
            {hasReconciliation && <VerdictBadge verdict={mapping.verdict!} />}
          </div>
        </td>

        {/* Status */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          <StatusBadge />
        </td>

        {/* Actions */}
        <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle' }}>
          {mapping.status === 'proposed' ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <ActionBtn onClick={onConfirm} bg="var(--green-bg)" border="#a7f3d0" title="Confirm">
                <Check size={11} color="var(--green)" />
              </ActionBtn>
              <ActionBtn onClick={() => setEditing(true)} bg="var(--bg-surface)" border="var(--border)" title="Edit">
                <Edit2 size={11} color="var(--text-secondary)" />
              </ActionBtn>
              <ActionBtn onClick={onReject} bg="var(--red-bg)" border="#fecaca" title="Reject">
                <X size={11} color="var(--red)" />
              </ActionBtn>
            </div>
          ) : (
            <button
              onClick={onReset}
              title="Undo"
              style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
                gap: 3, fontSize: '0.7rem', color: 'var(--text-muted)',
              }}
            >
              <RotateCcw size={11} /> Undo
            </button>
          )}
        </td>
      </tr>

      {/* Expanded reconciliation details */}
      {hasReconciliation && expanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <SignalBreakdown
              signals={mapping.signals ?? []}
              reasoning={mapping.reconciliation_reasoning}
              proposalAField={mapping.proposal_a_field}
              proposalBField={mapping.proposal_b_field}
              proposalAConfidence={mapping.proposal_a_confidence}
              proposalBConfidence={mapping.proposal_b_confidence}
              humanReviewPrompt={mapping.human_review_prompt}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function ActionBtn({
  children, onClick, bg, border, title,
}: { children: React.ReactNode; onClick: () => void; bg: string; border: string; title: string }) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        all: 'unset', cursor: 'pointer',
        width: 26, height: 26, borderRadius: 6,
        background: bg, border: `1px solid ${border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
