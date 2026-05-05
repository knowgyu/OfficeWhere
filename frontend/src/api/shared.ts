export type FileType = 'Excel' | 'Word' | 'PowerPoint' | 'Unknown'
export type CompareMode = 'excel' | 'word' | 'ppt'
export type CellValue = string | number | boolean | null | undefined

export interface FileInfo {
  id: number
  name: string
  path: string
  file_type: string
  column_count: number
  created_at?: string
  file_mtime?: number | null
  availability_status?: 'available' | 'missing' | string
  last_seen_at?: string | null
  missing_since?: string | null
  missing_last_checked_at?: string | null
  missing_reason?: string | null
  compare_capabilities?: string[]
}
