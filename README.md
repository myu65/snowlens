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
demo with orders, inventory, production, quality and experiments. No credentials
are needed. Mock saved metadata persists in `.snowlens-mock.json` (gitignored).

## What v0.1 does

- Browse Table, View, Dynamic Table and Semantic View sources directly.
- Search fields by name/description, type, category, recommendation and recent use.
- Choose row grouping (including numeric identifiers), field + aggregation values,
  conditions and server-side sorting. Six ordinary aggregation functions are available.
- Click a cell to include/exclude, group, drill, inspect detail or copy; return with Undo.
- Save raw or curated views, favorite sources, find recent items, and export a bounded CSV page.
- Publish a Dataset without code: exposed fields, labels, descriptions, recommendations,
  current default query and drill candidates. Semantic metrics retain Snowflake definitions.
- Keep previous results during updates; debounce/cancel obsolete requests; virtualize rows
  and field lists. Default page is 200 rows, maximum is 1,000.

The mock proves these UI flows. Live Snowflake deployment, role/masking policies and
Semantic View compatibility still require validation in a connected account; see
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
