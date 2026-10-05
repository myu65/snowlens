"use client";
import { useState } from "react";
import type { CatalogPage, CatalogRequest } from "@/lib/catalog";
import type { QueryableSource } from "@/lib/model";

function Level({
  scope,
  onOpen,
}: {
  scope: CatalogRequest;
  onOpen: (source: QueryableSource) => void;
}) {
  const [page, setPage] = useState<CatalogPage>({ names: [], sources: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ browse: "1", ...scope });
      if (more && page.next) params.set("after", page.next);
      const response = await fetch("/api/catalog?" + params, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      const next = data as CatalogPage;
      setPage((old) => ({
        ...next,
        names: [...new Set([...(more ? old.names : []), ...next.names])],
        sources: [
          ...new Map(
            [...(more ? old.sources : []), ...next.sources].map((s) => [
              s.id,
              s,
            ]),
          ).values(),
        ],
      }));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="database">
      {!loaded && (
        <button disabled={busy} onClick={() => void load()}>
          {busy
            ? "読み込み中…"
            : scope.kind
              ? "データを表示"
              : scope.database
                ? "スキーマを表示"
                : "データベースを表示"}
        </button>
      )}
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>再取得</button>
        </p>
      )}
      {loaded && !page.names.length && (
        <p className="muted">アクセスできる項目がありません。</p>
      )}
      {scope.kind
        ? page.sources.map((source) => (
            <button
              className="source-open"
              key={source.id}
              onClick={() => onOpen(source)}
            >
              <strong>{source.name}</strong>
              <small>{source.description}</small>
              <span className="kind">{source.kind}</span>
            </button>
          ))
        : page.names.map((name) => (
            <details key={name}>
              <summary>{name}</summary>
              {scope.database ? (
                (
                  ["table", "view", "dynamic_table", "semantic_view"] as const
                ).map((kind) => (
                  <details key={kind}>
                    <summary>{kind.replaceAll("_", " ").toUpperCase()}</summary>
                    <Level
                      scope={{ database: scope.database, schema: name, kind }}
                      onOpen={onOpen}
                    />
                  </details>
                ))
              ) : (
                <Level scope={{ database: name }} onOpen={onOpen} />
              )}
            </details>
          ))}
      {page.next && (
        <button disabled={busy} onClick={() => void load(true)}>
          {busy ? "読み込み中…" : "次の100件"}
        </button>
      )}
    </div>
  );
}
export default function CatalogBrowser({
  onOpen,
}: {
  onOpen: (source: QueryableSource) => void;
}) {
  // Levels load only on explicit expansion; no account-wide relation discovery.
  return (
    <div>
      <p className="muted">
        データベース、スキーマの順に開いてデータを探します。
      </p>
      <Level scope={{}} onOpen={onOpen} />
    </div>
  );
}
