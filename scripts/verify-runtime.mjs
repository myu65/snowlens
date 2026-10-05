import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "@playwright/test";

const configPath = process.env.SNOWLENS_LIVE_CONFIG;
assert(
  configPath,
  "Set SNOWLENS_LIVE_CONFIG to a local two-user validation config. No mock fallback.",
);
const config = JSON.parse(await readFile(configPath, "utf8"));
assert(
  new URL(config.baseURL).protocol === "https:",
  "Use the HTTPS App Runtime ingress URL.",
);
assert(
  config.users?.length === 2 && config.users.every((u) => u.storageState),
  "Two signed-in user storage states are required.",
);
assert(
  config.sources?.length >= 4,
  "Provide baseline queries for all four source kinds.",
);
assert.deepEqual(
  new Set(config.sources.map((s) => s.kind)),
  new Set(["table", "view", "dynamic_table", "semantic_view"]),
);
assert(
  config.deniedQuery && config.ownerDataset,
  "Denied-source query and owner-publish Dataset fixture are required.",
);
assert(
  config.personal?.table &&
    config.personal?.query &&
    config.personal?.expected?.length === 2,
  "Provide synthetic personal-input and both direct-caller join baselines (use {TABLE_ID} placeholders).",
);
assert(
  config.relationJoin?.query &&
    config.relationJoin?.expected?.length === 2 &&
    config.relationJoin?.counts?.length === 2,
  "Provide a unique-key relation join and exact two-user result/count baselines.",
);
assert(
  config.summary?.query && config.summary?.expected?.length === 2,
  "Provide two exact grand-total baselines, including AVG or COUNT DISTINCT, with a paged aggregate query.",
);

const clients = await Promise.all(
  config.users.map((u) =>
    request.newContext({
      baseURL: config.baseURL,
      storageState: u.storageState,
      extraHTTPHeaders: { Origin: new URL(config.baseURL).origin },
    }),
  ),
);
async function get(client, url) {
  const response = await client.get(url);
  assert(response.ok(), "Runtime GET failed: " + url.split("?")[0]);
  return response.json();
}
async function post(client, url, data) {
  return client.post(url, { data });
}
function substitute(value, id) {
  if (typeof value === "string") return value.replaceAll("{TABLE_ID}", id);
  if (Array.isArray(value)) return value.map((item) => substitute(item, id));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        substitute(key, id),
        substitute(item, id),
      ]),
    );
  return value;
}
try {
  for (const client of clients)
    assert.equal(
      (await get(client, "/api/catalog")).mode,
      "snowflake",
      "Live verification must never run against mock mode.",
    );
  for (const fixture of config.sources) {
    assert(
      fixture.expected?.length === 2,
      "Both direct-caller SELECT baselines are required.",
    );
    for (const [i, client] of clients.entries()) {
      const source = await get(
        client,
        "/api/catalog?source=" + encodeURIComponent(fixture.query.source),
      );
      assert.equal(source.kind, fixture.kind);
      const response = await post(client, "/api/query", {
        query: fixture.query,
      });
      assert(
        response.ok(),
        "Live query failed for " + fixture.kind + " user " + i,
      );
      const actual = await response.json();
      assert.deepEqual(actual.columns, fixture.expected[i].columns);
      assert.deepEqual(
        actual.rows,
        fixture.expected[i].rows,
        "Policy/masking results differ from direct caller baseline: " +
          fixture.kind +
          " user " +
          i,
      );
    }
    console.log("PASS caller query/baseline: " + fixture.kind);
  }
  const denial = await post(clients[1], "/api/query", {
    query: config.deniedQuery,
  });
  assert(
    !denial.ok(),
    "Denied user unexpectedly read the restricted relation.",
  );
  console.log("PASS SELECT denial");
  const id = "live-audit-" + randomUUID();
  const saved = {
    id,
    name: "Live rights audit",
    query: config.sources[0].query,
  };
  assert(
    (
      await post(clients[0], "/api/state", { kind: "saved", payload: saved })
    ).ok(),
    "Private save failed.",
  );
  assert((await get(clients[0], "/api/state")).saved.some((v) => v.id === id));
  assert(
    !(await get(clients[1], "/api/state")).saved.some((v) => v.id === id),
    "Saved view leaked across callers.",
  );
  const sourceId = config.sources[0].query.source;
  const before = await Promise.all(
    clients.map((client) => get(client, "/api/state")),
  );
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "favorite",
        payload: sourceId,
      })
    ).ok(),
  );
  const after = await Promise.all(
    clients.map((client) => get(client, "/api/state")),
  );
  assert.equal(
    after[0].favorites.includes(sourceId),
    !before[0].favorites.includes(sourceId),
  );
  assert.deepEqual(after[1].favorites, before[1].favorites);
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "favorite",
        payload: sourceId,
      })
    ).ok(),
    "Favorite restoration failed.",
  );
  console.log("PASS private saved views/favorites");
  const tableId = "live-input-" + randomUUID();
  const personal = { ...config.personal.table, id: tableId, version: 1 };
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "personal",
        payload: personal,
      })
    ).ok(),
    "Private input creation failed.",
  );
  const ownerState = await get(clients[0], "/api/state");
  const summary = ownerState.personalTables.find((t) => t.id === tableId);
  assert(
    summary &&
      summary.rowCount === personal.rows.length &&
      summary.rows.length === 0,
    "Summary API must omit all input rows.",
  );
  assert(
    !(await get(clients[1], "/api/state")).personalTables.some(
      (t) => t.id === tableId,
    ),
    "Private input list leaked.",
  );
  assert(
    !(await clients[1].get("/api/personal-table?id=" + tableId)).ok(),
    "Guessed private ID exposed rows.",
  );
  const joined = substitute(config.personal.query, tableId);
  const forbidden = await post(clients[1], "/api/query", { query: joined });
  assert(!forbidden.ok(), "Other caller joined the owner's input.");
  assert(
    !(
      await post(clients[1], "/api/state", {
        kind: "personal_delete",
        payload: { id: tableId, version: 1 },
      })
    ).ok(),
    "Other caller deleted private input.",
  );
  const ownJoin = await post(clients[0], "/api/query", { query: joined });
  assert(ownJoin.ok(), "Private caller join failed.");
  const ownResult = await ownJoin.json(),
    ownExpected = substitute(config.personal.expected[0], tableId);
  assert.deepEqual(ownResult.columns, ownExpected.columns);
  assert.deepEqual(ownResult.rows, ownExpected.rows);
  // IDs are scoped to principals: B may create an independent table with the same ID.
  assert(
    (
      await post(clients[1], "/api/state", {
        kind: "personal",
        payload: personal,
      })
    ).ok(),
    "Independent caller-owned ID creation failed.",
  );
  const otherJoin = await post(clients[1], "/api/query", { query: joined });
  assert(otherJoin.ok());
  const otherResult = await otherJoin.json(),
    otherExpected = substitute(config.personal.expected[1], tableId);
  assert.deepEqual(otherResult.columns, otherExpected.columns);
  assert.deepEqual(otherResult.rows, otherExpected.rows);
  const editable = await get(clients[0], "/api/personal-table?id=" + tableId);
  assert.deepEqual(editable.rows, personal.rows);
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "personal",
        payload: { ...editable, name: editable.name + " updated" },
      })
    ).ok(),
  );
  assert(
    !(
      await post(clients[0], "/api/state", {
        kind: "personal",
        payload: editable,
      })
    ).ok(),
    "Stale input update was accepted.",
  );
  assert(
    !(
      await post(clients[0], "/api/state", {
        kind: "personal_delete",
        payload: { id: tableId, version: 1 },
      })
    ).ok(),
    "Stale delete was accepted.",
  );
  assert.equal(
    (await get(clients[1], "/api/personal-table?id=" + tableId)).name,
    personal.name,
    "Other principal's same-ID table was modified.",
  );
  for (const [i, client] of clients.entries()) {
    const counts = await post(client, "/api/join-preview", {
      query: config.relationJoin.query,
    });
    assert(counts.ok());
    assert.deepEqual(await counts.json(), config.relationJoin.counts[i]);
    const relation = await post(client, "/api/query", {
      query: config.relationJoin.query,
    });
    assert(relation.ok());
    const result = await relation.json();
    assert.deepEqual(result.columns, config.relationJoin.expected[i].columns);
    assert.deepEqual(result.rows, config.relationJoin.expected[i].rows);
    const total = await post(client, "/api/query", {
      query: config.summary.query,
    });
    assert(total.ok());
    assert.deepEqual(
      (await total.json()).grandTotal,
      config.summary.expected[i],
      "Grand total differs from the exact direct-caller grain.",
    );
  }
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "personal_delete",
        payload: { id: tableId, version: 2 },
      })
    ).ok(),
  );
  assert(
    (
      await post(clients[1], "/api/state", {
        kind: "personal_delete",
        payload: { id: tableId, version: 1 },
      })
    ).ok(),
  );
  console.log(
    "PASS input ownership, same-ID isolation, versions, joins and exact totals",
  );
  const dataset = { ...config.ownerDataset, id: "live-owner-" + randomUUID() };
  assert(
    (
      await post(clients[0], "/api/state", {
        kind: "dataset",
        payload: dataset,
      })
    ).ok(),
    "Owner publish failed.",
  );
  assert(
    !(
      await post(clients[1], "/api/state", {
        kind: "dataset",
        payload: { ...dataset, name: "Unauthorized update" },
      })
    ).ok(),
    "Non-owner updated Dataset.",
  );
  assert(
    !(
      await post(clients[1], "/api/state", {
        kind: "dataset",
        payload: { ...dataset, id: "live-denied-" + randomUUID() },
      })
    ).ok(),
    "Explorer unexpectedly published Dataset.",
  );
  console.log("PASS Dataset Owner grants");
  console.log(
    "API checks passed. Complete query-history cancellation and ingress-spoofing checks in docs/runtime-validation.md before closing #5.",
  );
  console.log(
    "Created synthetic saved view and Dataset IDs: " + id + ", " + dataset.id,
  );
} finally {
  await Promise.all(clients.map((client) => client.dispose()));
}
