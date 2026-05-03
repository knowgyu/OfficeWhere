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
  compare_capabilities?: string[]
}
