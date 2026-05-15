import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  BASE_BACKEND_STARTUP_TIMEOUT_MS,
  MAX_BACKEND_STARTUP_TIMEOUT_MS,
  backendStartupTimeoutMsForFootprint,
  resolveBackendStartupBudget,
  sqliteDataFootprintBytes,
} from '../electron/backendStartup'

describe('backend startup budget', () => {
  it('keeps the default timeout for small or missing SQLite data', () => {
    expect(backendStartupTimeoutMsForFootprint(0)).toBe(BASE_BACKEND_STARTUP_TIMEOUT_MS)
    expect(backendStartupTimeoutMsForFootprint(128 * 1024 * 1024)).toBe(BASE_BACKEND_STARTUP_TIMEOUT_MS)
  })

  it('extends the timeout for multi-GB SQLite data', () => {
    const gib = 1024 * 1024 * 1024

    expect(backendStartupTimeoutMsForFootprint(3.4 * gib)).toBe(570_000)
  })

  it('caps very large data directories', () => {
    const gib = 1024 * 1024 * 1024

    expect(backendStartupTimeoutMsForFootprint(50 * gib)).toBe(MAX_BACKEND_STARTUP_TIMEOUT_MS)
  })

  it('counts only SQLite database and sidecar files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officewhere-startup-'))
    try {
      fs.writeFileSync(path.join(dir, 'data.db'), 'abc')
      fs.writeFileSync(path.join(dir, 'data.db-wal'), 'de')
      fs.writeFileSync(path.join(dir, 'other-cache.bin'), 'ignored')

      expect(sqliteDataFootprintBytes(dir)).toBe(5)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allows an environment override while preserving sane bounds', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officewhere-startup-'))
    try {
      expect(resolveBackendStartupBudget(dir, { OW_BACKEND_STARTUP_TIMEOUT_MS: '120000' })).toMatchObject({
        timeoutMs: 120_000,
        reason: 'env',
      })
      expect(resolveBackendStartupBudget(dir, { OW_BACKEND_STARTUP_TIMEOUT_MS: '1' })).toMatchObject({
        timeoutMs: BASE_BACKEND_STARTUP_TIMEOUT_MS,
        reason: 'env',
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
