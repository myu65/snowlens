# SnowLens development

Read `docs/ux-principles.md` for product and writing rules. Use the installed
`yomiyasu` skill for Japanese UI copy and documentation when it is available.
Preserve technical meaning, constraints and the distinction between implemented
behavior and a design proposal. Do not vendor a user's personal skill into the repo.

Read `docs/permissions-storage.md` before changing identity, persistence or grants,
and `docs/join-publication.md` before changing joins or Semantic View publication.
Keep source queries under fresh restricted caller rights. Storage procedure owners
must not acquire business-data SELECT or publication privileges. Never use a
username, role, browser-supplied owner or custom session attribute as a fallback
for an unregistered private principal.

Use Issue → branch → PR → self-review → green CI → merge. Follow `CONTRIBUTING.md`.
Mock/UI checks do not validate SQL procedures or live Snowflake policies. Keep
Issue #5 open until the two-user and identity-lifecycle checks pass in App Runtime.
