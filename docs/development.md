# Development

Install Node 22+, then `npm ci` and `npm run dev`. Mock mode is the default.
Tests use deterministic generated data. E2E starts its own production server on port
3001 with isolated disposable metadata. A live deployment requires an actual
Snowflake account with App Runtime enabled. Integration claims must be verified
in that account; mock tests cannot validate grants or masking policies.

Project management uses GitHub issues, branches, PR self-review and green CI.
