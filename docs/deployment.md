# Deploy to Snowflake App Runtime

Requires an account with App Runtime enabled (not a trial), Snowflake CLI 3.26+
and a role allowed to create Application Services. No Docker build is needed.

1. Configure a Snowflake CLI connection and run `snow connection test`.
2. Review `sql/setup.sql`, choose your app database/schema and run setup as admin.
   The row access policy attachment runs once. Assign scoped caller grants on
   warehouse, data databases/schemas/relations and the metadata table to the
   service-owner role. Grant data and metadata privileges to actual users.
3. Edit `app.yml`: database, schema, query warehouse and metadata database must
   match. Runtime provides `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_HOST` and token mount.
4. From this project, run `snow app deploy` using the chosen service-owner role.
5. Find the URL with `SHOW APPLICATION SERVICES` or `DESCRIBE APPLICATION SERVICE
SNOWFLAKE_APPS.APP.SNOWLENS`. Grant service access using the current App Runtime
   access-control instructions.
6. Validate using TWO users with different roles: a denied source must not become
   readable; row-access/masking results must match direct caller SELECT; saved
   views/favorites must be private; owner changes must be restricted; query abort
   should cancel execution. Try Table, View, Dynamic Table and Semantic View.

All catalog, data and metadata statements use caller rights. The app refuses live
requests without the trusted `Sf-Context-Current-User-Token` ingress header and
`/snowflake/session/token`; do not expose this process directly or forward caller
headers from an untrusted proxy. Runtime should strip/replace client-supplied
context headers. User query execution never switches to owner rights.

Live deployment has not been validated without a connected Snowflake account.
Catalog browsing loads databases, schemas and each relation kind in 100-object
pages. Browsing metadata is cached in memory for 15 seconds, scoped to a hash of
the caller token plus current user/primary/secondary roles. Source resolution and
data queries always recheck fresh caller metadata and Snowflake permissions. Column publication in a
Dataset is not a permission grant; users may still open raw sources they can SELECT.
CSV exports the current bounded page. Query cache lasts for the browser tab until
refresh; refresh after policy or data changes. Semantic fact drill-through uses an owner-configured separately accessible raw
relation, explicit dimension-to-column mappings and published detail columns.
Unmapped conditions fail closed. Metric compatibility and required window
dimensions use SHOW SEMANTIC DIMENSIONS ... FOR METRIC. These limits are visible in the UI/docs.

Official references (checked 2026-10-05):

- [App Runtime manifest](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/app-yml)
- [Query Snowflake and caller rights](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/query-snowflake)
- [Caller token composition](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/tutorials/advanced/tutorial-7-callers-rights)
- [Semantic SQL](https://docs.snowflake.com/en/sql-reference/constructs/semantic_view)
