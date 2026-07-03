export type RequestConfig = {
  signal?: AbortSignal
}

export type ApiResponse<T> = {
  data: T
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(url, init)
  const data = await readBody(response)
  if (!response.ok) {
    throw { response: { status: response.status, data } }
  }
  return { data: data as T }
}

function jsonInit(method: string, data: unknown, config?: RequestConfig): RequestInit {
  return {
    method,
    signal: config?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}

export const get = <T>(url: string, config?: RequestConfig) =>
  request<T>(url, { method: 'GET', signal: config?.signal })

export const post = <T>(url: string, data?: unknown, config?: RequestConfig) =>
  data === undefined
    ? request<T>(url, { method: 'POST', signal: config?.signal })
    : request<T>(url, jsonInit('POST', data, config))

export const put = <T>(url: string, data?: unknown, config?: RequestConfig) =>
  request<T>(url, jsonInit('PUT', data, config))

export const del = <T>(url: string, config?: RequestConfig & { data?: unknown }) =>
  config?.data === undefined
    ? request<T>(url, { method: 'DELETE', signal: config?.signal })
    : request<T>(url, jsonInit('DELETE', config.data, config))
