/** DI tokens. Injection is explicit (no reflected metadata) so any TS transpiler works. */
export const PRISMA = Symbol('PRISMA');
export const IDENTITY_VERIFIER = Symbol('IDENTITY_VERIFIER');
export const LOGGER = Symbol('LOGGER');
/** `{ preview: boolean }`: whether unreleased packs may be started (dev, qa, local, tests). */
export const PACK_RELEASE = Symbol('PACK_RELEASE');
