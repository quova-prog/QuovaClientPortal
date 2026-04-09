import { computeFileHash } from './fileHash'

/**
 * Check if a file with this hash was already uploaded for this org+table.
 * Returns { isDuplicate: true, uploadedAt: ISO string } if found.
 */
export async function checkFileAlreadyUploaded(
  db: any,
  orgId: string,
  file: File,
  tableName: string,
): Promise<{ isDuplicate: boolean; uploadedAt?: string; filename?: string }> {
  const hash = await computeFileHash(file)

  const { data, error } = await db
    .from('upload_batches')
    .select('created_at, filename')
    .eq('org_id', orgId)
    .eq('file_hash', hash)
    .eq('table_name', tableName)
    .limit(1)

  if (error || !data || data.length === 0) {
    return { isDuplicate: false }
  }

  return {
    isDuplicate: true,
    uploadedAt: data[0].created_at as string,
    filename: data[0].filename as string,
  }
}

/**
 * Record a completed upload batch (call after successful insert).
 */
export async function recordUploadBatch(
  db: any,
  orgId: string,
  userId: string | undefined,
  file: File,
  tableName: string,
  rowCount: number,
): Promise<void> {
  const hash = await computeFileHash(file)

  await db
    .from('upload_batches')
    .insert({
      org_id: orgId,
      uploaded_by: userId ?? null,
      filename: file.name,
      file_hash: hash,
      table_name: tableName,
      row_count: rowCount,
      status: 'complete',
    })

  // Fire-and-forget audit log for upload
  ;db.from('audit_logs').insert({
    org_id:     orgId,
    user_id:    userId ?? null,
    action:     'upload',
    resource:   tableName,
    summary:    `Uploaded ${rowCount} rows to ${tableName}`,
    metadata:   { filename: file.name, row_count: rowCount },
  }).then(() => {}).catch((err: unknown) => {
    console.warn('[uploadDedup] audit log insert failed:', err)
  })
}

/**
 * Format an ISO date string for display in error messages.
 */
export function formatUploadDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}
