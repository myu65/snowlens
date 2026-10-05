# v0.1 UX and self-review

Reviewed 2026-10-05 using the local production build, in-app browser and Playwright.

## Findings and fixes

- Opening raw sources goes directly to a bounded detail preview with simple
  recommended grouping, rather than a mandatory Dataset or configuration screen.
- Row grouping is labelled 行 / グループ化 and numeric IDs are explicitly eligible.
  Aggregation is an adjacent select on each value, with Japanese labels and SQL names.
- Field search supports type/category/recommendation/recent fields and description.
  The 120-column experiment fixture finds measurement 100 without a checkbox wall.
- Raw drill originally left the cell menu over the field picker. Hide the parent
  menu while choosing the next field, retaining the clicked row context.
- Drill/detail applies the complete grouped row context, and Undo restores the
  prior query. Curated drill suggestions and raw field selection share the same model.
- Keep the grid visible during loading or errors. Disable stale cell actions while
  updating. Filter edits debounce 180ms and cancel prior requests.
- Keep raw recommendations available while paging/sorting detail rows. Once a
  grouping/value is chosen, retire the introductory prompt.
- Add stable secondary sort fields to avoid jumping between ties on different pages.
- Demo month generation originally correlated a product exclusively to September;
  generate dates across products so a normal October filter still exercises drill.
- Separate disposable E2E metadata and port from the user's local mock workspace.
- A missing metadata store must not hide otherwise accessible raw data. Load the
  catalog independently and surface save-storage failure as a notice.
- Dataset recommendation edits now feed field selection. Dataset publication and
  personal saves have separate Snowflake table privileges.
- Production startup uses ordinary Next.js output to match `npm start` in App Runtime.
- Reset page scroll when opening a source or returning home so the result heading
  and conditions stay visible after browsing a long source list.
- On desktop, keep the exploration workspace within the viewport with independent
  scrolling for settings and results; on phones use a stacked page layout.
- Republishing an existing Dataset now refreshes the active query, so unpublished
  detail columns disappear immediately without requiring the user to refresh.

## Validation scope

Automated UI journeys cover raw and curated filters → aggregation → sorting →
drill → detail → Undo; saved-view reload; numeric grouping; owner publishing;
favorite; CSV download; all four relation kinds in mock mode; row virtualization;
pagination; empty result; retained result while loading; retry after a query error;
390px responsive width; invalid API input and dataset field scope enforcement.
An additional regression edits field exposure in an already-published detail Dataset.

Unit tests cover SHOW metadata parsing, inference, native Semantic View aliases,
pre-aggregation filtering without accidental grain changes, logical validation,
all ordinary aggregations, bound values/quoted identifiers, null operators,
pagination bounds, Dataset validation, Saved View serialization, caller-token
requirements, CSV escaping and bounded request bodies.

## Known limits / follow-ups

- No connected Snowflake account or Snowflake CLI was available for live deployment.
  Real caller grants, masking/row policies, semantic relationships and cancellation
  must be checked in an enabled account using the two-user deployment checklist.
- Discovery is capped at 10,000 objects per SHOW category and is revalidated on each
  query. Large accounts need lazy schema browsing and identity-scoped catalog caching.
- CSV is the current bounded page, not an unbounded extract.
- Semantic detail is dimension combinations. Physical fact drill-through needs an
  explicitly mapped accessible raw relation; relationship/window-metric compatibility
  currently returns Snowflake's query error rather than precomputing compatibility.
- Mock mode is one local user. Production state uses Snowflake storage and RBAC.
- Offset pagination is not a consistent snapshot while data changes.
- Modal focus trapping, URL/shareable query state, version conflicts and a more
  granular owner workflow are candidates for subsequent releases.
- `npm audit --omit=dev` has no production vulnerabilities. Full audit currently
  reports a braces issue inherited by the Next.js ESLint toolchain; no patched
  compatible dependency is available. Do not lint untrusted projects with this setup.
