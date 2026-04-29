import { Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLog } from '@/hooks/useAuditLog'
import { parseWorkdayCsv } from '@/lib/csvParser'
import { UploadWizard } from '@/components/upload/UploadWizard'

export function ExposuresUploadSection() {
  const { user, db } = useAuth()
  const { log } = useAuditLog()

  async function parseExposures(file: File) {
    const result = await parseWorkdayCsv(file)
    return { data: result.rows, errors: result.errors, warnings: result.warnings }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Upload Exposures</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
            Import FX exposure data from your ERP or spreadsheets
          </p>
        </div>
      </div>
      <div className="page-content">
        <UploadWizard
          label="Exposures"
          icon={Upload}
          color="#0ea5e9"
          accept=".csv"
          parse={parseExposures}
          columns={[
            { key: 'entity', label: 'Entity' },
            { key: 'currency_pair', label: 'Currency Pair' },
            { key: 'direction', label: 'Direction' },
            { key: 'notional_base', label: 'Notional', format: (value) => value?.toLocaleString() ?? '—' },
            { key: 'settlement_date', label: 'Settlement Date' },
            { key: 'description', label: 'Description' },
          ]}
          onImport={async (rows, entityId) => {
            if (!user?.profile?.org_id) return { error: 'Not authenticated' }
            const orgId = user.profile.org_id

            try {
              const { data: batch, error: batchErr } = await db
                .from('upload_batches')
                .insert({
                  org_id: orgId,
                  uploaded_by: user.id,
                  filename: 'exposure-upload.csv',
                  row_count: rows.length,
                  status: 'processing',
                })
                .select()
                .single()

              if (batchErr) throw new Error(batchErr.message)

              const insertRows = rows.map(row => ({
                ...row,
                org_id: orgId,
                entity_id: entityId ?? null,
                upload_batch_id: batch?.id ?? null,
                status: 'open' as const,
              }))

              const { error: rowsErr } = await db.from('fx_exposures').insert(insertRows)
              if (rowsErr) {
                if (batch) {
                  await db
                    .from('upload_batches')
                    .update({ status: 'failed', error_message: rowsErr.message })
                    .eq('id', batch.id)
                }

                await log({
                  action: 'upload',
                  resource: 'fx_exposures',
                  resource_id: batch?.id,
                  summary: 'Exposure upload failed',
                  metadata: {
                    filename: 'exposure-upload.csv',
                    row_count: rows.length,
                    error: rowsErr.message,
                  },
                })

                return { error: rowsErr.message }
              }

              if (batch) {
                await db.from('upload_batches').update({ status: 'complete' }).eq('id', batch.id)
              }

              await log({
                action: 'upload',
                resource: 'fx_exposures',
                resource_id: batch?.id,
                summary: `Uploaded ${rows.length} exposure rows`,
                metadata: {
                  filename: 'exposure-upload.csv',
                  row_count: rows.length,
                  entity_id: entityId ?? null,
                },
              })

              return { error: null }
            } catch (error) {
              return { error: error instanceof Error ? error.message : 'Upload failed' }
            }
          }}
        />
      </div>
    </div>
  )
}
