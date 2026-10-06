"use client";
import { useEffect, useState } from "react";
import type { CatalogPage, CatalogRequest } from "@/lib/catalog";
import type { QueryableSource } from "@/lib/model";

function Level({
  scope,
  onOpen,
  onScopeChange,
}: {
  scope: CatalogRequest;
  onOpen: (source: QueryableSource) => void;
  onScopeChange: (scope: CatalogRequest) => void;
}) {
  const [page, setPage] = useState<CatalogPage>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(scope.database ? 1 : 0),
    [busy, setBusy] = useState(!!scope.database);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    if (!retry) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      browse: "1",
      ...JSON.parse(scopeKey),
    });
    fetch("/api/catalog?" + params, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (!controller.signal.aborted) {
          setPage(data);
          setBusy(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [scopeKey, retry]);
  return (
    <div className="database">
      {!page && !busy && !error && (
        <button
          onClick={() => {
            setBusy(true);
            setRetry((r) => r + 1);
          }}
        >
          データベースを表示
        </button>
      )}
      {busy && <p role="status">読み込み中…</p>}
      {error && (
        <p role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setBusy(true);
              setRetry((r) => r + 1);
            }}
          >
            再取得
          </button>
        </p>
      )}
      {page && !page.names.length && (
        <p className="muted">アクセスできる項目がありません。</p>
      )}
      {scope.kind
        ? page?.sources.map((source) => (
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
        : page?.names.map((name) => (
            <button
              className="source-open"
              key={name}
              onClick={() =>
                onScopeChange(
                  scope.database
                    ? { database: scope.database, schema: name }
                    : { database: name },
                )
              }
            >
              {name}
              <span>→</span>
            </button>
          ))}
      {page?.next && (
        <button onClick={() => onScopeChange({ ...scope, after: page.next })}>
          次の100件
        </button>
      )}
    </div>
  );
}
export default function CatalogBrowser({
  onOpen,
  scope,
  onScopeChange,
}: {
  onOpen: (source: QueryableSource) => void;
  scope?: CatalogRequest;
  onScopeChange?: (scope: CatalogRequest) => void;
}) {
  const [localScope, setLocalScope] = useState<CatalogRequest>({});
  const selected = scope || localScope;
  const change = onScopeChange || setLocalScope;
  // Resolve only this path, in 100-object pages. A deep link does not trigger
  // account-wide discovery, and metadata never authorizes a source query.
  return (
    <div className="catalog-navigation">
      <p className="muted">
        データベース、スキーマの順に開いてデータを探します。
      </p>
      <nav aria-label="カタログの場所">
        <button onClick={() => change({})}>データベース</button>
        {selected.database && (
          <>
            <span> / </span>
            <button onClick={() => change({ database: selected.database })}>
              {selected.database}
            </button>
          </>
        )}
        {selected.schema && (
          <>
            <span> / </span>
            <button
              onClick={() =>
                change({ database: selected.database, schema: selected.schema })
              }
            >
              {selected.schema}
            </button>
          </>
        )}
        {selected.kind && (
          <span> / {selected.kind.replaceAll("_", " ").toUpperCase()}</span>
        )}
      </nav>
      {selected.schema && !selected.kind ? (
        <div className="browser-tabs">
          {(["table", "view", "dynamic_table", "semantic_view"] as const).map(
            (kind) => (
              <button
                key={kind}
                onClick={() => change({ ...selected, kind, after: undefined })}
              >
                {kind.replaceAll("_", " ").toUpperCase()}
              </button>
            ),
          )}
        </div>
      ) : (
        <Level
          key={JSON.stringify(selected)}
          scope={selected}
          onOpen={onOpen}
          onScopeChange={change}
        />
      )}
    </div>
  );
}
