import { describe, expect, it } from 'vitest'
import { installBridge } from '../test/bridge'

describe('getBackendBaseUrl', () => {
  it('uses the Electron preload bridge when present', async () => {
    const bridge = installBridge({
      getBackendBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18999'),
    })

    const { getBackendBaseUrl } = await import('./transport')
    const url = await getBackendBaseUrl()

    expect(url).toBe('http://127.0.0.1:18999')
    expect(bridge.getBackendBaseUrl).toHaveBeenCalledOnce()
  })

  it('caches the result across repeated calls', async () => {
    const bridge = installBridge({
      getBackendBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18888'),
    })

    const { getBackendBaseUrl } = await import('./transport')
    await getBackendBaseUrl()
    await getBackendBaseUrl()
    await getBackendBaseUrl()

    expect(bridge.getBackendBaseUrl).toHaveBeenCalledOnce()
  })

  it('falls back to an empty string when no bridge is installed (web prod)', async () => {
    // No installBridge() call → window.officeWhere is undefined.
    // import.meta.env.DEV is true under Vitest's default mode but
    // VITE_BACKEND_URL is unset, so the fallback is an empty string.
    const { getBackendBaseUrl } = await import('./transport')
    const url = await getBackendBaseUrl()

    expect(url).toBe('')
  })
})

describe('apiPath', () => {
  it('joins the backend base URL with a path', async () => {
    installBridge({
      getBackendBaseUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18765'),
    })

    const { apiPath } = await import('./transport')
    const url = await apiPath('/api/health')

    expect(url).toBe('http://127.0.0.1:18765/api/health')
  })
})

describe('__resetForTests', () => {
  it('clears the cached promise so the next call re-queries the bridge', async () => {
    const firstBridge = installBridge({
      getBackendBaseUrl: vi.fn().mockResolvedValue('http://first.test'),
    })

    const transport = await import('./transport')
    const before = await transport.getBackendBaseUrl()
    expect(before).toBe('http://first.test')

    transport.__resetForTests()

    const secondBridge = installBridge({
      getBackendBaseUrl: vi.fn().mockResolvedValue('http://second.test'),
    })
    const after = await transport.getBackendBaseUrl()

    expect(after).toBe('http://second.test')
    expect(firstBridge.getBackendBaseUrl).toHaveBeenCalledOnce()
    expect(secondBridge.getBackendBaseUrl).toHaveBeenCalledOnce()
  })
})
