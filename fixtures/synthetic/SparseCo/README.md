# SparseCo (synthetic)

**Purpose:** exercise the unhappy data paths connectors and normalization must
survive without inventing conclusions.

Expected conditions once seeded (T-002+):

- Missing optional and required fields.
- Multi-page provider responses (pagination and resumable cursors).
- Stale data past freshness thresholds.
- Duplicate display names that must not be joined by name alone.
- Partial permissions: some scopes granted, others denied.

The product should surface gaps explicitly rather than fill them.
