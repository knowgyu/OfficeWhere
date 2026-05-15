import fs from 'node:fs'
import path from 'node:path'

export const BASE_BACKEND_STARTUP_TIMEOUT_MS = 30_000
export const MAX_BACKEND_STARTUP_TIMEOUT_MS = 10 * 60_000
export const LARGE_BACKEND_DATA_THRESHOLD_BYTES = 512 * 1024 * 1024
export const EXTRA_TIMEOUT_PER_GIB_MS = 3 * 60_000

const SQLITE_DATA_FILES = ['data.db', 'data.db-wal', 'data.db-shm', 'data.db-journal']

type BackendStartupBudgetReason = 'default' | 'large-data' | 'env'

export type BackendStartupBudget = {
  timeoutMs: number
  footprintBytes: number
  reason: BackendStartupBudgetReason
}

function clampTimeoutMs(value: number): number {
  return Math.min(MAX_BACKEND_STARTUP_TIMEOUT_MS, Math.max(BASE_BACKEND_STARTUP_TIMEOUT_MS, value))
}

function parseTimeoutOverride(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return clampTimeoutMs(Math.round(parsed))
}

export function sqliteDataFootprintBytes(dataDir: string): number {
  return SQLITE_DATA_FILES.reduce((total, fileName) => {
    try {
      const stat = fs.statSync(path.join(dataDir, fileName))
      return stat.isFile() ? total + stat.size : total
    } catch {
      return total
    }
  }, 0)
}

export function backendStartupTimeoutMsForFootprint(footprintBytes: number): number {
  if (footprintBytes <= LARGE_BACKEND_DATA_THRESHOLD_BYTES) {
    return BASE_BACKEND_STARTUP_TIMEOUT_MS
  }

  const gib = 1024 * 1024 * 1024
  const extraGiB = Math.ceil((footprintBytes - LARGE_BACKEND_DATA_THRESHOLD_BYTES) / gib)
  return clampTimeoutMs(BASE_BACKEND_STARTUP_TIMEOUT_MS + extraGiB * EXTRA_TIMEOUT_PER_GIB_MS)
}

export function resolveBackendStartupBudget(
  dataDir: string,
  env: Partial<Pick<NodeJS.ProcessEnv, 'OW_BACKEND_STARTUP_TIMEOUT_MS'>> = process.env,
): BackendStartupBudget {
  const override = parseTimeoutOverride(env.OW_BACKEND_STARTUP_TIMEOUT_MS)
  const footprintBytes = sqliteDataFootprintBytes(dataDir)
  if (override !== null) {
    return { timeoutMs: override, footprintBytes, reason: 'env' }
  }

  const timeoutMs = backendStartupTimeoutMsForFootprint(footprintBytes)
  return {
    timeoutMs,
    footprintBytes,
    reason: timeoutMs > BASE_BACKEND_STARTUP_TIMEOUT_MS ? 'large-data' : 'default',
  }
}
