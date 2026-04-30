export type FileType = 'Excel' | 'Word' | 'PowerPoint' | 'Unknown'
export type CompareMode = 'excel' | 'word' | 'ppt'
export type CellValue = string | number | boolean | null | undefined

export interface ExcelParserConfig {
  sheet_name: string
  header_row: number
  start_col: number
  end_col: number
  end_row?: number | null
}

export type ParserConfig = ExcelParserConfig | Record<string, unknown>

export interface FileInfo {
  id: number
  name: string
  path: string
  file_type: string
  key_column: string
  column_count: number
  created_at?: string
  file_mtime?: number | null
  parser_config?: ParserConfig | null
  compare_capabilities?: string[]
}
