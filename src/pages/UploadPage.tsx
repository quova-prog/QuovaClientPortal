import { useState } from 'react'
import { UploadSectionGrid } from '@/features/upload/UploadSectionGrid'
import { UploadSectionDetail } from '@/features/upload/UploadSectionDetail'
import { useUploadSectionStats } from '@/features/upload/useUploadSectionStats'
import type { UploadSectionId } from '@/features/upload/uploadCatalog'

// ── Main component ─────────────────────────────────────────────────────────────

export function UploadPage() {
  const [activeSection, setActiveSection] = useState<UploadSectionId | null>(null)
  const { counts, lastUploads } = useUploadSectionStats()

  // ── Drill-down view ──────────────────────────────────────────────────────────

  if (activeSection !== null) {
    return <UploadSectionDetail sectionId={activeSection} onBack={() => setActiveSection(null)} />
  }

  // ── Card grid view ───────────────────────────────────────────────────────────

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Data Management</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            Upload, manage and analyze all your treasury and FX data
          </p>
        </div>
      </div>
      <UploadSectionGrid
        counts={counts}
        lastUploads={lastUploads}
        onSelect={setActiveSection}
      />
    </div>
  )
}
