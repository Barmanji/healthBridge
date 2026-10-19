/**
 * Test stub for the `server-only` marker package.
 *
 * Next.js resolves `server-only` to a build-time guard. Vitest runs in plain Node, so the
 * marker is aliased to this no-op. Tests for server code are still valid here: the modules
 * under test are pure logic and the assertion is about behaviour, not bundling.
 */
export {};
