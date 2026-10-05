# Architecture

Snowflake Data → optional Dataset → Saved View. A Dashboard is not a domain object.

Next.js App Router serves a React/TypeScript UI and four server APIs:

- `GET /api/catalog`: lazy caller-visible database/schema/relation pages, or
  freshly resolved fields and optional metric compatibility for one source.
- `POST /api/fact-detail`: owner-mapped physical detail under fresh caller rights.
- `POST /api/query`: logical query only, optional dataset scope, bounded CSV.
- `GET/POST /api/state`: Dataset, Saved View, Favorite and Recent definitions.

`QueryableSource` supports tables, views, dynamic tables and semantic views.
Relation kinds may be extended without adding another database provider. Ordinary
relations share a compiler. Numeric columns remain eligible as dimensions. Measures
are field + aggregation, except Snowflake-defined semantic metrics.

The server resolves sources against a fresh caller-visible catalog and fields
against SHOW COLUMNS or SHOW SEMANTIC DIMENSIONS/METRICS. The compiler validates
the full logical query, field membership, types, aggregation/operator allowlists,
result sort membership, limits and offsets. Identifiers are quoted server metadata;
values are binds. Browser SQL is never accepted. Table filters/aggregation/order
execute in Snowflake. Semantic queries use SEMANTIC_VIEW with native metrics,
explicit output aliases and pre-aggregation WHERE. Filter-only dimensions do not
change aggregation grain. Metric compatibility and required window dimensions come from SHOW SEMANTIC
DIMENSIONS IN ... FOR METRIC. The server validates selected dimensions; the UI
adds required dimensions when choosing a metric. Snowflake still executes the
semantic engine. Without a Dataset mapping, semantic detail shows dimension
combinations. With an owner-configured factDetail mapping, a separate dialog
queries a caller-accessible raw relation, carries every filter and cell row
dimension across explicit column mappings, and returns only published detail
columns. Missing mappings fail closed. No arbitrary joins or expressions are
accepted. The source aggregate remains visible behind the dialog.

Every live request gets a separate OAuth session using the rotating service token
plus trusted ingress caller token. Missing caller context fails closed. No owner
fallback, server result cache, credential exposure or cross-user connection reuse.
RBAC, masking and row-access policies remain enforced by Snowflake. Local live
credentials are intentionally unsupported to avoid silently testing owner rights.

App definitions are VARIANT payloads with owner, kind, id and timestamp.
APP.METADATA holds personal Saved Views, Favorites and Recent Items behind a
Snowflake row access policy. APP.DATASETS holds published definitions with separate
GRANT SELECT for explorers and write grants for Dataset Owner roles.
Dataset field publication is a UI scope, not a new
security boundary: raw access is governed by Snowflake. Dataset updates verify
the current owner; Dataset Owners with direct DATASETS table write privileges can still
change shared definitions using SQL. Trusted Dataset Owners should control these
grants. Metadata does not contain business query results or a catalog mirror.
Mock metadata is serialized to a gitignored local JSON file; mock is single-user.

Queries return at most 1,000 rows plus one lookahead; default page is 200. Offset
is capped at 100,000. The UI virtualizes result rows and the field picker, debounces
requests, aborts obsolete work, keeps previous results, and maintains 30 result
entries in a per-tab cache. Refresh invalidates it. Session statement timeout is
60s; request abort cancels the active statement. Results have deterministic sort
for pagination but offset paging is not a transaction snapshot.

The mock provider has deterministic 12,000-row chemical data per source and a
120-column experimental relation. It runs the same validation before execution.
Mock tests verify product flows but cannot prove real Snowflake integration.

Live catalog browsing uses 100-object pages within selected schemas. A bounded
200-entry in-memory browsing cache expires after 15 seconds and is scoped to a
hash of the caller token plus CURRENT_USER/ROLE/SECONDARY_ROLES. It is never
used to authorize a query. Source resolution inspects only the exact name in its
schema against fresh SHOW results; no account-wide scans are performed.
