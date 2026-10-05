# Live App Runtime validation

Issue #5 remains open until these checks run in an enabled Snowflake account.
Mock, metadata fixtures and HTTP cancellation alone are not proof of caller rights.
The [connected-account record](snowflake-validation.md) separates direct SQL checks
from App Runtime validation, which remains blocked by the test account's trial status.

## Prerequisites

- Deploy through the trusted App Runtime ingress using `docs/deployment.md`.
- Prepare two distinct test users: A has Dataset Owner write grants; B has only
  explorer grants. Avoid admin roles for either caller.
- Also test both users with the same shared explorer role and switch A between
  shared explorer/editor roles. Private ownership must follow the immutable
  principal, while source access follows the active grants and policies.
- Register different immutable principal IDs and install the narrow private and
  Dataset write procedures. Neither caller/runtime role may inherit direct store
  DML, identity-admin privileges, storage-owner roles or business source ownership.
- Prepare small synthetic Table, View, Dynamic Table and Semantic View sources
  accessible to both. Include row-access and masking policies so the two users
  receive measurably different rows/values. Prepare a separate source B cannot SELECT.
- Under each user's actual role, run each exact compiled query directly in
  Snowflake. Record the expected columns and normalized rows for comparison.
  Do not compare to owner-role output or assume the expected values.
- Sign into the deployed app separately as A and B and export Playwright storage
  states locally. Store them under `playwright-auth/`, never commit them. Each
  state contains authentication material. Do not add ingress caller headers yourself.

## Automated API checks

Create a local, gitignored `playwright-auth/runtime-config.json` with:

```json
{
  "baseURL": "https://YOUR-APP-RUNTIME-INGRESS",
  "users": [
    { "storageState": "playwright-auth/user-a.json" },
    { "storageState": "playwright-auth/user-b.json" }
  ],
  "sources": [
    {
      "kind": "table",
      "query": {
        "source": "[\"AUDIT_DB\",\"AUDIT_SCHEMA\",\"AUDIT_TABLE\"]",
        "dimensions": [],
        "metrics": [],
        "filters": [],
        "sort": [],
        "detail": true,
        "limit": 200,
        "offset": 0
      },
      "expected": [
        {
          "columns": ["REGION", "SECRET"],
          "rows": [{ "REGION": "A", "SECRET": "clear" }]
        },
        {
          "columns": ["REGION", "SECRET"],
          "rows": [{ "REGION": "B", "SECRET": "masked" }]
        }
      ]
    }
  ],
  "deniedQuery": {},
  "ownerDataset": {}
}
```

Replace every example value. Add baseline queries for `view`, `dynamic_table`
and `semantic_view`; complete `deniedQuery` and a valid `ownerDataset` definition.
The script fails if any prerequisite is missing or if the deployed app is mock.
Use the real object identities and application serialization, including native
semantic metrics. Run from the repository root:

Also provide these fixtures. All expected results must come from exact direct
caller SQL on synthetic data, not from app output. Personal tables are created
separately for A and B with the same ID to verify principal scoping.

| Config key     | Required contents                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personal`     | `table` with name, typed columns and rows; `query` for its LEFT/INNER join; two `expected` column/row baselines. Use `{TABLE_ID}` in `join.tableId`, private aliases and expected object keys; the script replaces it with the generated audit ID. |
| `relationJoin` | A unique-right-key `query`, two exact `expected` column/row baselines and two `counts` objects matching the join-preview contract.                                                                                                                 |
| `summary`      | A grouped, filtered query with `totals: "grand"` and nonzero page offset; two `expected` grand-total row objects. Include AVG or COUNT DISTINCT to detect invalid reaggregation.                                                                   |

```powershell
$env:SNOWLENS_LIVE_CONFIG = 'playwright-auth/runtime-config.json'
npm run test:live
```

The script checks all four source kinds against both direct-caller baselines,
SELECT denial, private Saved Views/Favorites, successful owner publication and
denied explorer creation/update, private input isolation including guessed IDs and
independent same-ID tables, stale edits/deletes, source-policy-aware joins and
exact grand totals. It restores the changed favorite and removes both synthetic
input tables after success. It creates
synthetic audit metadata and prints exact IDs; remove only those rows afterward
as the owning test user/admin. A failure must remain a failure; do not weaken a
baseline to match unexpected runtime behavior.

## Required manual evidence

1. Confirm no trusted caller context can be injected through a direct/untrusted
   path. Send a request with a forged `Sf-Context-Current-User-Token` through the
   deployed ingress; verify it is replaced/rejected and cannot access the other
   caller's rows. Confirm requests missing runtime service/caller credentials fail.
2. Query a deliberately slow, permitted synthetic relation; trigger UI cancellation
   or close the request. In Snowflake query history, verify the associated statement
   was cancelled or ended promptly, rather than only disappearing in the browser.
3. Revoke a test SELECT grant after discovery, Refresh and verify the next query
   is denied and previous results disappear. Live mode must recheck repeated
   queries instead of returning cached results. Check that another caller's
   browsing cache cannot expose that user's catalog.
4. Exercise a native metric with required window dimensions and an incompatible
   dimension. Verify required dimensions and rejection match Snowflake metadata.
5. Configure a semantic fact-detail Dataset. Compare detail rows to the direct
   raw caller SELECT with all mapped conditions; verify unmapped conditions fail
   and nonpublished columns are absent. Deny raw-source access and verify detail fails.
6. Under each test role, try direct INSERT/UPDATE/DELETE of a private row with
   another owner ID, and direct Dataset DML. All must fail. Call the permitted
   storage procedure directly with forged owner JSON; it must never write another
   principal's rows. B must be unable to call the Dataset procedure successfully.
7. Test missing/duplicate username registrations and a principal ID assigned to
   two enabled users; private access must fail. Rename a synthetic user while
   keeping its ID. Disable/delete it before name reuse, then assign a fresh ID to
   the new person and prove old input/definitions are absent. Exercise a role
   change and show private ownership remains attached to the authenticated user.
8. Race two edits and a stale delete against one input version. Exactly one edit
   may win. Test concurrent initial creation and detect duplicate standard-table
   IDs; do not claim uniqueness without this evidence. Corrupt owned test JSON
   using admin access and verify it cannot widen source/column access.
9. Compare LEFT/INNER join row counts, masked keys, NULL keys, empty input and
   right-side duplicates under both roles. Change lookup data between preview
   and execution; the statement's uniqueness guard must reject fanout. Verify
   exact string equality and source join/projection/aggregation policy denial.
10. Compare ROLLUP subtotals and paged grand totals to each direct caller query.
    Include uneven group sizes, repeated distinct values and actual NULL keys.
    Verify required-dimension semantic metrics do not invent grand totals.
11. Review a generated publication draft and execute only in an approved synthetic
    schema as the permitted publisher. Compare LEFT/INNER grain and metrics,
    including COUNT(*), then query as both readers before granting production
    access. Exercise readers without base SELECT and verify the approved row and
    masking boundaries. Keep private input, filter values and private names out
    of DDL. Maintain lookup uniqueness after publication.

Attach account/version, deployment revision, synthetic fixture definitions,
redacted query-history IDs, PASS/FAIL results and both role names to Issue #5.
Do not attach tokens, cookies, auth state, real business rows or private results.
Close it only after every check succeeds.
