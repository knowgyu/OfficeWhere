import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const PROVIDER_DISCOVERY_FILENAME = 'provider-discovery.json'
export const PROVIDER_API_BASE_PATH = '/api/provider/v1'
export const PROVIDER_DISCOVERY_STALE_RULE =
  'Treat this discovery document as stale unless the pid is alive and GET /api/provider/v1/health plus /api/provider/v1/manifest agree with provider, contract_version, app_version, and api_base_path.'

type BuildProviderDiscoveryOptions = {
  appVersion: string
  baseUrl: string
  pid?: number
  generatedAt?: Date
  discoveryId?: string
}

export type ProviderDiscoveryPayload = {
  provider: 'OfficeWhere'
  contract_version: 'v1'
  app_version: string
  api_base_path: typeof PROVIDER_API_BASE_PATH
  base_url: string
  health_url: string
  manifest_url: string
  pid: number
  discovery_id: string
  generated_at: string
  updated_at: string
  stale_rule: string
}

export type ProviderDiscoveryHandle = {
  path: string
  discoveryId: string
  pid: number
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function getProviderDiscoveryPath(userDataPath: string): string {
  return path.join(userDataPath, PROVIDER_DISCOVERY_FILENAME)
}

export function buildProviderDiscovery(options: BuildProviderDiscoveryOptions): ProviderDiscoveryPayload {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const generatedAt = (options.generatedAt ?? new Date()).toISOString()
  const pid = options.pid ?? process.pid
  const discoveryId = options.discoveryId ?? randomUUID()

  return {
    provider: 'OfficeWhere',
    contract_version: 'v1',
    app_version: options.appVersion,
    api_base_path: PROVIDER_API_BASE_PATH,
    base_url: baseUrl,
    health_url: `${baseUrl}${PROVIDER_API_BASE_PATH}/health`,
    manifest_url: `${baseUrl}${PROVIDER_API_BASE_PATH}/manifest`,
    pid,
    discovery_id: discoveryId,
    generated_at: generatedAt,
    updated_at: generatedAt,
    stale_rule: PROVIDER_DISCOVERY_STALE_RULE,
  }
}

export async function writeProviderDiscovery(
  userDataPath: string,
  payload: ProviderDiscoveryPayload,
): Promise<ProviderDiscoveryHandle> {
  await fs.promises.mkdir(userDataPath, { recursive: true })

  const finalPath = getProviderDiscoveryPath(userDataPath)
  const tempPath = path.join(userDataPath, `${PROVIDER_DISCOVERY_FILENAME}.${payload.pid}.${payload.discovery_id}.tmp`)
  const json = `${JSON.stringify(payload, null, 2)}\n`

  await fs.promises.writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.promises.rename(tempPath, finalPath)
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }

  return { path: finalPath, discoveryId: payload.discovery_id, pid: payload.pid }
}

function ownsDiscovery(payload: unknown, handle: ProviderDiscoveryHandle): boolean {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<ProviderDiscoveryPayload>
  return candidate.provider === 'OfficeWhere' && candidate.pid === handle.pid && candidate.discovery_id === handle.discoveryId
}

export async function cleanupProviderDiscovery(handle: ProviderDiscoveryHandle): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(handle.path, 'utf8')
    if (!ownsDiscovery(JSON.parse(raw), handle)) return false
    await fs.promises.rm(handle.path, { force: true })
    return true
  } catch {
    return false
  }
}

export function cleanupProviderDiscoverySync(handle: ProviderDiscoveryHandle): boolean {
  try {
    const raw = fs.readFileSync(handle.path, 'utf8')
    if (!ownsDiscovery(JSON.parse(raw), handle)) return false
    fs.rmSync(handle.path, { force: true })
    return true
  } catch {
    return false
  }
}
