# Architecture

Snowflake Data → optional Dataset → Saved View. A Dashboard is not a domain object.

Next.js App Router serves a React/TypeScript UI and three server APIs:

* `GET /api/catalog`: live caller-visible sources, or fields for one source.
* `POST /api/query`: logical query only, optional dataset scope, bounded CSV.
* `GET/POST /api/state`: Dataset, Saved View, Favorite and Recent definitions.

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
change aggregation grain. Incompatible relationship/window metrics surface errors
from Snowflake; SnowLens does not recreate a semantic engine. Semantic detail shows
dimension combinations, not underlying fact rows; use a raw source for fact detail.

Every live request gets a separate OAuth session using the rotating service token
plus trusted ingress caller token. Missing caller context fails closed. No owner
fallback, server result cache, credential exposure or cross-user connection reuse.
RBAC, masking and row-access policies remain enforced by Snowflake. Local live
credentials are intentionally unsupported to avoid silently testing owner rights.

App definitions are VARIANT payloads in APP.METADATA, with owner, kind, id and
timestamp. A Snowflake row access policy isolates personal definitions while
allowing published datasets. Dataset field publication is a UI scope, not a new
security boundary: raw access is governed by Snowflake. Dataset updates verify
the current owner; app users with direct metadata table write privileges can still
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
