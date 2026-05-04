import type { HttpHandler } from 'msw'

/**
 * Default MSW handlers shared across all tests.
 *
 * Phase 1 starts with an empty list. Phase 2 will populate this with the
 * ~30 backend endpoints (Tier A: schema-accurate fixtures for the core
 * search/group/duplicates flows; Tier B: shape-correct stubs for the
 * remaining endpoints).
 *
 * setup.ts uses `onUnhandledRequest: 'error'`, which means any test that
 * triggers a real HTTP call without a matching handler will fail loudly.
 * That is intentional: it prevents accidental network access and forces
 * handlers to stay synchronized with the API client.
 */
export const handlers: HttpHandler[] = []
