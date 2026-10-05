# Architecture

Snowflake Data → optional Dataset → Saved View. A Dashboard is not a domain object.

Next.js App Router serves a React/TypeScript UI and these server APIs:

- `GET /api/catalog`: lazy caller-visible database/schema/relation pages, or
  freshly resolved fields and optional metric compatibility for one source.
- `POST /api/fact-detail`: owner-mapped physical detail under fresh caller rights.
- `POST /api/query`: logical query only, optional Dataset scope, exact totals and bounded CSV.
- `POST /api/export`: fresh scoped execution plus Excel report/data sheets or CSV;
  bounded current page, validated personal labels, no browser-supplied rows.
- `POST /api/join-preview`: caller-visible key counts without materializing a fanout join.
- `GET /api/personal-table`: full input rows for a single owned ID.
- `POST /api/semantic-draft`: selected model definitions as downloadable DDL, without execution.
- `GET/POST /api/state`: Dataset, Saved View, Favorite, Recent and personal-table state.

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
columns. Missing mappings fail closed. Joins accept one validated equality key,
server-resolved source metadata and LEFT/INNER mode. Arbitrary expressions and
browser SQL are rejected. Private input is validated typed JSON, bound and expanded
with FLATTEN. Right fields receive stable aliases; source Dataset scope is retained.
Lookup keys must be unique. The general join verifies uniqueness within the same
statement as the result, as well as in preview. String keys use exact UTF-8 equality.

Every live request gets a separate OAuth session using the rotating service token
plus trusted ingress caller token. Missing caller context fails closed. No owner
fallback, server result cache, credential exposure or cross-user connection reuse.
RBAC, masking and row-access policies remain enforced by Snowflake. Local live
credentials are intentionally unsupported to avoid silently testing owner rights.

App definitions are VARIANT payloads with owner, kind, id and timestamp.
APP.METADATA holds private definitions and APP.PERSONAL_TABLES holds user-entered
data, both behind a row access policy. APP.PRINCIPALS maps authenticated users to
immutable private owner IDs. An absent or ambiguous mapping cannot read or write
private state; an administrator must handle rename, deletion and name reuse.
APP.DATASETS holds shared definitions. Two narrow owner-rights procedures write
private state and shared Datasets respectively. Neither owner can SELECT business
sources; callers receive procedure USAGE, never direct store DML or owner roles.
RAP alone cannot prevent forged inserts, which is why writes use procedures.
Source queries always retain caller rights. Dataset publication grants no source
access. Stored JSON is validated again when read. Personal edits/deletes require
the current version. Definitions contain no result snapshots or catalog mirror.
The [storage design](permissions-storage.md) describes provisioning and migration.
Mock metadata is serialized to a gitignored local JSON file; mock is single-user.

Queries return at most 1,000 rows plus one lookahead; default page is 200. Offset
is capped at 100,000. The UI virtualizes result rows and the field picker, debounces
requests, aborts obsolete work and keeps previous results while loading. The mock
maintains 30 result entries in a per-tab cache. Live mode always requests fresh
caller results and clears previous results on errors, including denied access.
Refresh invalidates the mock cache. Session statement timeout is
60s; request abort cancels the active statement. Results have deterministic sort
for pagination but offset paging is not a transaction snapshot.

Bulk selection and drag edits share a logical-query composer. Dragging from detail
stages fields while keeping the detail grid; explicit Apply changes the grain.
Bulk composition infers dimensions versus measures and commits one Undo step.
Grand totals run a separate query with the same source, join and filters, without
dimensions or page offset. Subtotals use ROLLUP and GROUPING, so actual NULL keys
are distinguishable. They recompute AVG/distinct counts rather than summing page
cells. Semantic metrics requiring dimensions show an explanation instead of a
false grand total; native semantic subtotal support is deferred. Total and page
queries share a caller connection but not a transaction snapshot. Excel's report
sheet carries conditions, hierarchy and the source-computed grand total. Its native
data table contains normal page rows only. CSV has display-label or stable-ID headers
and optional marked subtotal rows; grand totals are excluded from CSV. The legacy
query CSV option retains raw result IDs and marked subtotals. Export metadata and
data resolve in the same fresh caller session; personal labels cannot add fields.
DATE values become native Excel dates; timestamp strings retain their timezone.
Formula-like text is stored as literal XLSX strings and neutralized for CSV. XLSX
rejects oversized/unsupported cell text instead of truncating it and caps each
sheet's page data at 500,000 cells. See [export layout](export-layout.md).

The mock provider has deterministic 12,000-row chemical data, a six-row product
lookup and a 120-column experimental relation. It runs the same validation before execution.
Mock tests verify product flows but cannot prove real Snowflake integration.

Live catalog browsing uses 100-object pages within selected schemas. A bounded
200-entry in-memory browsing cache expires after 15 seconds and is scoped to a
hash of the caller token plus CURRENT_USER/ROLE/SECONDARY_ROLES. It is never
used to authorize a query. Source resolution inspects only the exact name in its
schema against fresh SHOW results; no account-wide scans are performed.
