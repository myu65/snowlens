# Live App Runtime validation

Issue #5 remains open until these checks run in an enabled Snowflake account.
Mock, metadata fixtures and HTTP cancellation alone are not proof of caller rights.

## Prerequisites

- Deploy through the trusted App Runtime ingress using `docs/deployment.md`.
- Prepare two distinct test users: A has Dataset Owner write grants; B has only
  explorer grants. Avoid admin roles for either caller.
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

```powershell
$env:SNOWLENS_LIVE_CONFIG = 'playwright-auth/runtime-config.json'
npm run test:live
```

The script checks all four source kinds against both direct-caller baselines,
SELECT denial, private Saved Views/Favorites, successful owner publication and
denied explorer creation/update. It restores the changed favorite. It creates
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
3. Revoke a test SELECT grant after discovery, clear the browser result cache with
   Refresh, and verify the next query is denied. Check that another caller's
   browsing cache cannot expose that user's catalog.
4. Exercise a native metric with required window dimensions and an incompatible
   dimension. Verify required dimensions and rejection match Snowflake metadata.
5. Configure a semantic fact-detail Dataset. Compare detail rows to the direct
   raw caller SELECT with all mapped conditions; verify unmapped conditions fail
   and nonpublished columns are absent. Deny raw-source access and verify detail fails.

Attach account/version, deployment revision, synthetic fixture definitions,
redacted query-history IDs, PASS/FAIL results and both role names to Issue #5.
Do not attach tokens, cookies, auth state, real business rows or private results.
Close it only after every check succeeds.
