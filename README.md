# SnowLens

Fast, table-first Snowflake exploration for people who do not write SQL.
Open a table directly, group rows, aggregate values, filter, drill and save.
Datasets are optional business presets, never a prerequisite.

## Local development

Node.js 22 or newer and npm are required.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Default mode is a deterministic chemical manufacturer
demo with orders, inventory, production, quality, experiments and a product lookup. No credentials
are needed. Mock saved metadata persists in `.snowlens-mock.json` (gitignored).

## What v0.1 does

- Browse Table, View, Dynamic Table and Semantic View sources directly. Live
  catalogs load lazily by database/schema in 100-object pages.
- Search fields by name/description, type, category, recommendation and recent use.
- Choose row grouping (including numeric identifiers), field + aggregation values,
  conditions with contextual value candidates and server-side sorting. Select visible
  columns together, drag them into rows/values, reorder fields and undo the edit.
  Ordinary aggregates include row count, SUM, AVG, MIN, MAX, COUNT and COUNT DISTINCT.
- Show grand totals over all matching data and hierarchical subtotals. Averages and
  distinct counts are recomputed from source rows, independent of the current page.
  Semantic metrics keep their definitions; required-dimension metrics do not invent totals.
- Create private typed tables from spreadsheet paste or manual input (1,000 rows,
  12 columns), then LEFT/INNER join them to caller-accessible sources.
- Join Table/View/Dynamic Table nodes across schemas. Check exact caller-visible
  row growth, unmatched keys and duplicates before applying a single-key lookup join.
- Save personal field labels/descriptions along with filters, joins, grouping and totals.
- Download a reviewable Semantic View SQL draft for a permitted publisher or admin.
  The app does not execute publication DDL or grants.
- Click a cell to include/exclude, group, drill, inspect detail or copy; return with Undo.
- Save raw or curated views, favorite sources, find recent items, and export a bounded CSV page.
- Publish a Dataset without code: exposed fields, labels, descriptions, recommendations,
  current default query and drill candidates. Semantic metrics retain Snowflake definitions.
  Owners can map a semantic Dataset to physical detail columns; every condition
  must have an explicit mapping. Required metric dimensions use Snowflake metadata.
- Keep previous results during updates; debounce/cancel obsolete requests; virtualize rows
  and field lists. Default page is 200 rows, maximum is 1,000.

The mock proves these UI flows. Live Snowflake deployment, role/masking policies and
Semantic View compatibility, storage procedures and identity lifecycle still require validation in a connected account; see
[deployment limits](docs/deployment.md). Dataset publication is a UX definition,
not an additional data-permission layer.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

See [architecture](docs/architecture.md), [development](docs/development.md)
and [Snowflake deployment](docs/deployment.md). The [UX review](docs/ux-review.md)
records tested flows, fixes and known limits. Licensed under MIT.
The [UX principles](docs/ux-principles.md), [private storage and permissions](docs/permissions-storage.md)
and [join/publication design](docs/join-publication.md) document the current boundaries.

For actual two-user policy/rights checks, see [live validation](docs/runtime-validation.md).
`npm run test:live` requires local authenticated test-user states and direct-caller
baselines; it cannot pass in mock mode.
