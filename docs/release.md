# Releases

A release is a **version tag on a commit of `main`**: CalVer `vYYYY.MM.N`, for example `v2026.11.1` for the first release in November 2026, `v2026.11.2` for the next, and `v2026.12.1` in December. Nothing is tagged on merge: cutting a release is a deliberate act. Container images keep their commit-SHA tags, and deploys still run from `main` ([ADR 0019](adr/0019-deployable-environments.md)).

## Cut a release

1. Merge what's in it to `main`.
2. Actions → **release** → *Run workflow* on `main`.
   - **What it does:** tags the commit with the next version and publishes a GitHub Release with generated notes.
   - **What it refuses:**
     - a branch other than `main`;
     - a tag that already exists;
     - a commit that is already a release.
3. **Promote it** with the deploy workflow, on the interim path ([T-101](../tasks/ready/T-101.md)): Actions → **deploy** → `main` → `dev`, then `live`. Live waits for approval.

## Which release is where

- **In the app:** every page's footer, and **Settings → About Pactlab**, show `v2026.11.1 · build 9f36104`, or `build 9f36104` for a commit that isn't a release.
- **The API's `/health`:** returns `version` (the tag, or `null`) and `sha`.
- **The deploy run's summary:** starts with `Release v2026.11.1 (sha 9f361042) → live`.

Each deploy writes the version to the environment's `/pactlab/<env>/release` parameter, never into the task definitions. A new version therefore rolls no service by itself: only services whose code changed move.

## Roll back

Re-run **deploy** for the environment on the earlier commit. Revert on `main` first if needed, or dispatch from the earlier release's commit through a branch for dev. Migrations only ever add, so the older code runs on the newer database. The app then shows the older version.
