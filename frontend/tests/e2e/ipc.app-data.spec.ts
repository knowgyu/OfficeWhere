import { test, expect } from './fixtures'

/**
 * Tier 3 IPC. The Electron preload bridge exposes `getAppDataPaths` so the
 * settings tab can show the user where their cache / DB / config live and
 * offer cleanup. The renderer reaches main via IPC channel
 * `app:get-data-paths`. This spec drives the same call from inside the
 * renderer and asserts:
 *   1. The bridge returns a non-empty list of candidates.
 *   2. Every candidate lives under the test's tmp userDataDir (proves
 *      isolation — we are NOT looking at the developer's real OfficeWhere
 *      data).
 */

test('app:get-data-paths returns candidates anchored to the temp userData dir', async ({
  mainWindow,
  userDataDir,
}) => {
  const candidates = await mainWindow.evaluate(async () => {
    if (!window.officeWhere?.getAppDataPaths) {
      throw new Error('officeWhere.getAppDataPaths bridge missing')
    }
    return await window.officeWhere.getAppDataPaths()
  })

  expect(Array.isArray(candidates)).toBe(true)
  expect(candidates.length).toBeGreaterThan(0)

  // The handler also surfaces legacy data locations (e.g. ~/.officewhere
  // from earlier app versions) so the user can clean them up. Those are
  // *outside* our tmp dir by design — exclude them and assert the active
  // candidates anchor to the test's tmp userData dir.
  const activeCandidates = candidates.filter((c) => !c.id.startsWith('legacy-'))
  expect(activeCandidates.length).toBeGreaterThan(0)

  for (const candidate of activeCandidates) {
    expect(
      candidate.path.startsWith(userDataDir),
      `active app data candidate ${candidate.id} at ${candidate.path} is NOT under tmp ${userDataDir}`,
    ).toBe(true)
  }
})

test('app:get-close-behavior returns one of three known modes', async ({ mainWindow }) => {
  const behavior = await mainWindow.evaluate(async () => {
    if (!window.officeWhere?.getCloseBehavior) {
      throw new Error('officeWhere.getCloseBehavior bridge missing')
    }
    return await window.officeWhere.getCloseBehavior()
  })

  expect(['ask', 'hide', 'quit']).toContain(behavior)
})

test('app:set-close-behavior round-trips the persisted choice', async ({ mainWindow }) => {
  await mainWindow.evaluate(async () => {
    await window.officeWhere?.setCloseBehavior?.('hide')
  })
  const after = await mainWindow.evaluate(async () => {
    return await window.officeWhere?.getCloseBehavior?.()
  })
  expect(after).toBe('hide')

  // Restore default to keep the test idempotent.
  await mainWindow.evaluate(async () => {
    await window.officeWhere?.setCloseBehavior?.('ask')
  })
})
