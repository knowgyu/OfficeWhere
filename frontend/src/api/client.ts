import axios from 'axios'

const BASE = import.meta.env.DEV ? 'http://localhost:8765' : ''

export interface FileInfo {
  id: number
  name: string
  path: string
  file_type: string
  key_column: string
  column_count: number
  created_at?: string
}

export interface SchemaResponse {
  columns: string[]
  sample: string[][]
}

export interface FileInspectRequest {
  path: string
}

export interface FileInspectResponse {
  path: string
  name: string
  file_type: string
  columns: string[]
  sample: string[][]
  suggested_key_column?: string
}

export interface FilePickResponse {
  cancelled: boolean
  file: FileInspectResponse | null
}

export interface FileRegisterRequest {
  path: string
  key_column: string
}

export interface FileRegisterResponse {
  id: number
  name: string
  columns: string[]
}

export interface JoinFileSpec {
  file_id: number
  columns: string[]
}

export interface JoinRequest {
  files: JoinFileSpec[]
  join_type: 'left' | 'outer' | 'inner'
  base_file_id?: number
}

export interface JoinResponse {
  columns: string[]
  data: string[][]
  total_rows: number
}

export interface CheckRequest {
  file_ids: number[]
}

export interface ConflictEntry {
  file_id: number
  file_name: string
  columns: string[]
  values: string[]
  row_count: number
}

export interface CheckIssue {
  key_normalized: string
  key_variants: string[]
  column_group: string
  conflicts: ConflictEntry[]
  severity: 'conflict' | 'warning'
}

export interface CheckResponse {
  total_keys: number
  matched_keys: number
  issues: CheckIssue[]
}

export const api = {
  files: {
    list: () => axios.get<FileInfo[]>(`${BASE}/api/files`),
    inspect: (data: FileInspectRequest) =>
      axios.post<FileInspectResponse>(`${BASE}/api/files/inspect`, data),
    pick: () => axios.post<FilePickResponse>(`${BASE}/api/files/pick`),
    register: (data: FileRegisterRequest) =>
      axios.post<FileRegisterResponse>(`${BASE}/api/files`, data),
    delete: (id: number) => axios.delete(`${BASE}/api/files/${id}`),
    schema: (id: number) => axios.get<SchemaResponse>(`${BASE}/api/files/${id}/schema`),
    suggestKey: (id: number) =>
      axios.get<{ columns: string[]; suggested_key_column: string }>(
        `${BASE}/api/files/${id}/suggest-key`
      ),
  },
  query: {
    join: (data: JoinRequest) => axios.post<JoinResponse>(`${BASE}/api/query/join`, data),
    export: (data: JoinRequest) =>
      axios.post(`${BASE}/api/query/export`, data, { responseType: 'blob' }),
  },
  check: {
    run: (data: CheckRequest) => axios.post<CheckResponse>(`${BASE}/api/check`, data),
  },
}
