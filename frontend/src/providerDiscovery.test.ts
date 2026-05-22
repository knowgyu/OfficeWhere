import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  PROVIDER_API_BASE_PATH,
  PROVIDER_DISCOVERY_FILENAME,
  buildProviderDiscovery,
  cleanupProviderDiscovery,
  cleanupProviderDiscoverySync,
  getProviderDiscoveryPath,
  writeProviderDiscovery,
} from '../electron/providerDiscovery'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'officewhere-discovery-'))
}

describe('provider discovery', () => {
  it('builds discovery metadata with provider endpoints', () => {
    const payload = buildProviderDiscovery({
      appVersion: '0.11.1',
      baseUrl: 'http://127.0.0.1:49152/',
      pid: 12345,
      discoveryId: 'discovery-test',
      generatedAt: new Date('2026-05-22T12:00:00.000Z'),
    })

    expect(payload).toMatchObject({
      provider: 'OfficeWhere',
      contract_version: 'v1',
      app_version: '0.11.1',
      api_base_path: PROVIDER_API_BASE_PATH,
      base_url: 'http://127.0.0.1:49152',
      health_url: 'http://127.0.0.1:49152/api/provider/v1/health',
      manifest_url: 'http://127.0.0.1:49152/api/provider/v1/manifest',
      pid: 12345,
      discovery_id: 'discovery-test',
      generated_at: '2026-05-22T12:00:00.000Z',
      updated_at: '2026-05-22T12:00:00.000Z',
    })
    expect(Date.parse(payload.generated_at)).not.toBeNaN()
    expect(payload.stale_rule).toContain('pid is alive')
    expect(payload.stale_rule).toContain('/api/provider/v1/health')
    expect(payload.stale_rule).toContain('/api/provider/v1/manifest')
  })

  it('writes valid JSON discovery document to the user data path', async () => {
    const dir = makeTempDir()
    try {
      const payload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50001',
        pid: 222,
        discoveryId: 'write-test',
        generatedAt: new Date('2026-05-22T12:01:00.000Z'),
      })

      const handle = await writeProviderDiscovery(dir, payload)
      const parsed = JSON.parse(fs.readFileSync(handle.path, 'utf8'))

      expect(handle).toEqual({
        path: path.join(dir, PROVIDER_DISCOVERY_FILENAME),
        discoveryId: 'write-test',
        pid: 222,
      })
      expect(parsed).toEqual(payload)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes discovery atomically by replacing the final file and removing temp state', async () => {
    const dir = makeTempDir()
    try {
      const finalPath = getProviderDiscoveryPath(dir)
      fs.writeFileSync(finalPath, '{"provider":"old"}\n')
      const payload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50002',
        pid: 333,
        discoveryId: 'replace-test',
      })

      await writeProviderDiscovery(dir, payload)

      expect(JSON.parse(fs.readFileSync(finalPath, 'utf8'))).toEqual(payload)
      expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cleans up only the current process discovery file', async () => {
    const dir = makeTempDir()
    try {
      const payload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50003',
        pid: 444,
        discoveryId: 'cleanup-test',
      })
      const handle = await writeProviderDiscovery(dir, payload)

      await expect(cleanupProviderDiscovery(handle)).resolves.toBe(true)
      expect(fs.existsSync(handle.path)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not remove discovery owned by a newer process', async () => {
    const dir = makeTempDir()
    try {
      const oldPayload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50004',
        pid: 555,
        discoveryId: 'old-process',
      })
      const oldHandle = await writeProviderDiscovery(dir, oldPayload)
      const newPayload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50005',
        pid: 556,
        discoveryId: 'new-process',
      })
      await writeProviderDiscovery(dir, newPayload)

      await expect(cleanupProviderDiscovery(oldHandle)).resolves.toBe(false)
      expect(JSON.parse(fs.readFileSync(oldHandle.path, 'utf8'))).toEqual(newPayload)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sync cleanup preserves stale validation data when it cannot prove ownership', async () => {
    const dir = makeTempDir()
    try {
      const payload = buildProviderDiscovery({
        appVersion: '0.11.1',
        baseUrl: 'http://127.0.0.1:50006',
        pid: 777,
        discoveryId: 'stale-validation-data',
      })
      const handle = await writeProviderDiscovery(dir, payload)

      expect(cleanupProviderDiscoverySync({ ...handle, discoveryId: 'different-owner' })).toBe(false)
      const parsed = JSON.parse(fs.readFileSync(handle.path, 'utf8'))
      expect(parsed.pid).toBe(777)
      expect(parsed.health_url).toBe('http://127.0.0.1:50006/api/provider/v1/health')
      expect(parsed.manifest_url).toBe('http://127.0.0.1:50006/api/provider/v1/manifest')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
