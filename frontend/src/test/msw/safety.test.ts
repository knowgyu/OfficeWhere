import { describe, expect, it } from 'vitest'
import axios from 'axios'

/**
 * Verify the safety net: when a test triggers an HTTP request that no handler
 * matches, MSW must reject loudly. This catches the case where someone adds a
 * new endpoint to client.ts/library.ts without adding a default handler to
 * src/test/msw/handlers.ts.
 *
 * setup.ts configures `onUnhandledRequest: 'error'`, which prints the error
 * to stderr and rejects the request — visible to the test as a network error.
 */
describe('MSW unhandled request safety net', () => {
  it('rejects requests to endpoints without a registered handler', async () => {
    await expect(axios.get('/api/__nonexistent_endpoint__')).rejects.toBeDefined()
  })
})
