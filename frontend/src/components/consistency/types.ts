import { CheckResponse, ExcelDiffGridResponse, FileInfo, LibraryGroupDetail } from '../../api/client'

export type HistoryTransitionStatus = 'pending' | 'loading' | 'done' | 'error'

export interface HistoryTransition {
  id: string
  fromFile: FileInfo
  toFile: FileInfo
  status: HistoryTransitionStatus
  result: CheckResponse | null
  error?: string
}

export interface ExcelGridModalState {
  detail: LibraryGroupDetail
  loading: boolean
  data: ExcelDiffGridResponse | null
  error: string
}
