# Deploy to Snowflake App Runtime

Requires an account with App Runtime enabled (not a trial), Snowflake CLI 3.26+
and a role allowed to create Application Services. Private storage uses row access
policies, which require an eligible Snowflake edition. No Docker build is needed.

1. Configure a Snowflake CLI connection and run `snow connection test`.
2. Review `docs/permissions-storage.md`. Choose the app database/schema and dedicated
   identity/private-storage/Dataset-storage owner roles. Run `sql/setup.sql`,
   `sql/private-state.sql` and `sql/dataset-state.sql` as admin, then transfer the
   function/procedures to the narrow roles described in those scripts. RAP
   attachment runs once. Register immutable principals through the ID lifecycle.
   Grant explorers SELECT on stores and USAGE on the private procedure; grant
   Dataset editors USAGE on the separate Dataset procedure. Grant neither direct
   DML nor owner roles. Revoke inherited legacy write grants before upgrading.
   Assign restricted caller grants on warehouse, permitted data and the required
   store SELECT/function/procedure USAGE to the runtime role. Actual users also
   need the corresponding source/warehouse access.
3. Edit `app.yml`: set the service database/schema and query warehouse. The
   `SNOWLENS_METADATA_DATABASE` and `SNOWLENS_METADATA_SCHEMA` must match all three
   storage SQL scripts. Runtime provides `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_HOST`
   and token mount. The manifest excludes local auth states, screenshots and mock
   files from the deployment bundle; keep real credentials outside the project.
4. From this project, run `snow app deploy` using the chosen service-owner role.
5. Find the URL with `SHOW APPLICATION SERVICES` or `DESCRIBE APPLICATION SERVICE
SNOWFLAKE_APPS.APP.SNOWLENS`. Grant service access using the current App Runtime
   access-control instructions.
6. Validate using TWO users with different roles: a denied source must not become
   readable; row-access/masking results must match direct caller SELECT; saved
   views/favorites must be private; owner changes must be restricted; query abort
   should cancel execution. Try Table, View, Dynamic Table and Semantic View.

Catalog and source-data statements use restricted caller rights. Store writes use
the two fixed owner-rights procedures, whose owners have no business-source SELECT
or publication privileges. The app refuses live
requests without the trusted `Sf-Context-Current-User-Token` ingress header and
`/snowflake/session/token`; do not expose this process directly or forward caller
headers from an untrusted proxy. Runtime must strip/replace client-supplied
context headers. User query execution never switches to owner rights. Do not
deploy without verifying the identity function inside these procedures under
two real callers. Username reuse without disabling its prior principal is unsafe.

Live deployment has not been validated without a connected Snowflake account.
Catalog browsing loads databases, schemas and each relation kind in 100-object
pages. Browsing metadata is cached in memory for 15 seconds, scoped to a hash of
the caller token plus current user/primary/secondary roles. Source resolution and
data queries always recheck fresh caller metadata and Snowflake permissions. Column publication in a
Dataset is not a permission grant; users may still open raw sources they can SELECT.
Private input is stored separately from definitions and joined as bound JSON.
Summary lists omit the rows. Input edits/deletes carry an optimistic version;
duplicate storage IDs fail closed. Review standard-table concurrency and retention
limits in the storage design. General joins permit a unique right-side key only;
their counts and policies require live validation. Semantic publication stops at
downloadable DDL for a permitted publisher/admin to review and execute separately.
Excel and CSV export the current bounded page. Excel includes conditions and
source-computed totals plus a native table without subtotal rows. Live results are requested afresh on each
operation; errors remove previous results. Refresh after policy or data changes.
Semantic fact drill-through uses an owner-configured separately accessible raw
relation, explicit dimension-to-column mappings and published detail columns.
Unmapped conditions fail closed. Metric compatibility and required window
dimensions use SHOW SEMANTIC DIMENSIONS ... FOR METRIC. These limits are visible in the UI/docs.

Official references (checked 2026-10-05):

- [App Runtime manifest](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/app-yml)
- [Query Snowflake and caller rights](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/query-snowflake)
- [Caller token composition](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/tutorials/advanced/tutorial-7-callers-rights)
- [Semantic SQL](https://docs.snowflake.com/en/sql-reference/constructs/semantic_view)
- [Row access policy limits](https://docs.snowflake.com/en/user-guide/security-row-intro)
- [Owner and caller procedures](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
