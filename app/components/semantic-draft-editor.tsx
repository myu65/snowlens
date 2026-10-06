"use client";
import { useState } from "react";
import { useDraftWarning } from "./ledger-ui";
import type { Query, QueryableSource } from "@/lib/model";
export default function SemanticDraftEditor({
  source,
  query,
  datasetId,
  onClose,
}: {
  source: QueryableSource;
  query: Query;
  datasetId?: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<[string, string, string]>([
    source.database,
    "ANALYTICS",
    source.name + "_ANALYSIS",
  ]);
  const [method, setMethod] = useState("review"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<{
    sql: string;
    sources: string[];
    target: string[];
    requires: string[];
  }>();
  const [baseline] = useState(() => JSON.stringify([target, method]));
  const dirty = JSON.stringify([target, method]) !== baseline;
  const clearWarning = useDraftWarning(dirty);
  function close() {
    if (dirty && !window.confirm("公開先の変更を破棄して閉じますか？")) return;
    clearWarning();
    onClose();
  }
  const hasInputFilters =
    query.join &&
    "rightSource" in query.join &&
    !!(query.join.leftFilters?.length || query.join.rightFilters?.length);
  async function create() {
    setBusy(true);
    setError("");
    setDraft(undefined);
    try {
      const res = await fetch("/api/semantic-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, datasetId, target }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      setDraft(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!draft) return;
    const blob = new Blob([draft.sql], { type: "text/plain;charset=utf-8" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = draft.target[2] + ".sql";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="overlay">
      <section
        className="dialog owner fixed-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="セマンティックビューの公開下書き"
      >
        <div className="dialog-title">
          <h2>セマンティックビューの下書き</h2>
          <button aria-label="公開下書きを閉じる" onClick={close}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            選択した行項目と集計から、公開SQLを作ります。公開先や閲覧者の権限を確認してから実行します。
          </p>
          <div className="draft-target">
            {["データベース", "スキーマ", "ビュー名"].map((label, i) => (
              <label key={label}>
                {label}
                <input
                  aria-label={`公開先の${label}`}
                  maxLength={120}
                  value={target[i]}
                  onChange={(e) => {
                    setTarget(
                      (old) =>
                        old.map((v, j) =>
                          j === i ? e.target.value : v,
                        ) as typeof target,
                    );
                    setDraft(undefined);
                  }}
                />
              </label>
            ))}
          </div>
          <div className="join-types">
            <label>
              <input
                type="radio"
                name="publish-method"
                checked={method === "review"}
                onChange={() => setMethod("review")}
              />
              管理者に公開を依頼する
            </label>
            <label>
              <input
                type="radio"
                name="publish-method"
                checked={method === "direct"}
                onChange={() => setMethod("direct")}
              />
              公開権限があるので自分で実行する
            </label>
          </div>
          <p>
            {method === "review"
              ? "SQLと元データ・公開先・対象ロールを管理者へ渡して確認します。"
              : "公開先のCREATE権限と、組織が認めた公開範囲を確認してSQLを実行します。"}
          </p>
          <p className="muted">
            公開SQLには結合と集計の定義を含めます。検索条件と個人用の項目名は、この分析の保存した表示に残ります。
          </p>
          <p className="muted">
            セマンティックビューの閲覧権限だけで元データを読めるため、公開対象ロールとマスキング・行の制限を確認します。
          </p>
          <button
            disabled={busy || hasInputFilters || target.some((v) => !v.trim())}
            onClick={() => void create()}
          >
            {busy ? "下書きを作成中…" : "公開SQLを作る"}
          </button>
          {hasInputFilters && (
            <p className="error">
              結合前の条件がある表示は公開できません。対象範囲を共有Viewで定義してから、そのViewを結合してください。
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {draft && (
            <>
              <pre className="draft-sql" aria-label="公開SQL">
                {draft.sql}
              </pre>
              <p className="muted">
                生成したSQLはSnowflakeで未検証です。テスト用の公開先で、2ユーザーの結果と権限を確認してから公開してください。
              </p>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button onClick={close}>閉じる</button>
          <button className="primary" disabled={!draft} onClick={download}>
            公開SQLを保存
          </button>
        </div>
      </section>
    </div>
  );
}
