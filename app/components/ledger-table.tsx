"use client";
import { DraftLink } from "./ledger-ui";
import { useCallback, useEffect, useState } from "react";
import { useUrlState } from "./use-url-state";
import {
  ledgerTableHref,
  parseLedgerTableLocation,
} from "@/lib/ledger-location";
import { type LedgerDetail, type LedgerList } from "@/lib/ledger-model";
import {
  LedgerHeader,
  displayLedgerValue,
  ledgerApi,
  ledgerPath,
} from "./ledger-ui";
import LedgerRecordEditor from "./ledger-record-editor";
export default function LedgerTable({
  spaceId,
  id,
}: {
  spaceId: string;
  id: string;
}) {
  const [detail, setDetail] = useState<LedgerDetail>(),
    [rows, setRows] = useState<LedgerList>(),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [record, setRecord] = useState<string>(),
    [draftId, setDraftId] = useState<string>(),
    [notice, setNotice] = useState("");
  const onDirty = useCallback(() => {}, []);
  const { replaceNextWrite } = useUrlState(
    { row: record, draft: draftId, search, offset },
    {
      ready: true,
      parse: parseLedgerTableLocation,
      format: (value) => ledgerTableHref(ledgerPath(spaceId, id), value),
      apply: async (value) => {
        setRecord(value.row);
        setDraftId(
          value.row === "new" ? value.draft || crypto.randomUUID() : undefined,
        );
        setSearch(value.search);
        setOffset(value.offset);
        setError("");
        setRetry((r) => r + 1);
      },
      onError: () => {
        setRecord(undefined);
        setError("URLの行・検索条件の指定を確認してください。");
      },
    },
  );
  useEffect(() => {
    const controller = new AbortController();
    ledgerApi<LedgerDetail>(
      { kind: "detail", space: spaceId, id },
      undefined,
      controller.signal,
    )
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setDetail(undefined);
          setRows(undefined);
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [spaceId, id, retry]);
  useEffect(() => {
    if (!detail) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      ledgerApi<LedgerList>(
        { kind: "records", space: spaceId, id, search, offset: String(offset) },
        undefined,
        controller.signal,
      )
        .then((value) => {
          setRows(value);
          setError("");
          setLoading(false);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setRows(undefined);
            setError(e.message);
            setLoading(false);
          }
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [detail, spaceId, id, search, offset, retry]);
  function openRecord(value?: string, replace = false) {
    if (replace) replaceNextWrite();
    const draft = value === "new" ? crypto.randomUUID() : undefined;
    setRecord(value);
    setDraftId(draft);
  }
  const fields =
    detail?.definition.layout.tableColumns
      .map((column) =>
        detail.definition.layout.fields.find((f) => f.id === column)!,
      )
      .filter(Boolean) || [];
  return (
    <div className="app-shell">
      <LedgerHeader
        space={detail?.space.label}
        title={detail?.definition.layout.title}
      />
      <main className="ledger-table-page">
        <DraftLink href="/ledgers" className="back-link">
          ← 台帳一覧
        </DraftLink>
        <div className="ledger-page-heading">
          <div>
            <p className="eyebrow">{detail?.space.label}</p>
            <h1>{detail?.definition.layout.title || "台帳"}</h1>
            <p className="muted">{detail?.definition.layout.description}</p>
          </div>
          <div className="ledger-heading-actions">
            {detail?.capabilities.layout && (
              <DraftLink
                className="button-link"
                href={ledgerPath(spaceId, id) + "/layout"}
              >
                項目とレイアウト
              </DraftLink>
            )}
            {detail?.capabilities.insert && (
              <button className="primary" onClick={() => openRecord("new")}>
                ＋ 新しい行
              </button>
            )}
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              onClick={() => {
                setLoading(true);
                setError("");
                setRetry((r) => r + 1);
              }}
            >
              再読み込み
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {detail && (
          <>
            <div className="ledger-toolbar">
              <label>
                台帳を検索
                <input
                  aria-label="台帳の行を検索"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  placeholder="案件名や顧客など"
                />
              </label>
              <span className="ledger-permission-label">
                {detail.capabilities.insert || detail.capabilities.update
                  ? "入力可"
                  : "閲覧のみ"}
                {detail.capabilities.layout ? "・共通レイアウト編集可" : ""}
              </span>
              <button disabled={loading} onClick={() => setRetry((r) => r + 1)}>
                更新
              </button>
              <DraftLink
                className="button-link"
                href={"/?source=" + encodeURIComponent(detail.source.id)}
              >
                この台帳を集計する
              </DraftLink>
            </div>
            <p className="muted">
              行を押すと明細を開きます。空欄と0は区別して表示します。
            </p>
            <div className="ledger-table-scroll" aria-busy={loading}>
              <table className="ledger-data-table">
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <th key={f.id}>{f.label}</th>
                    ))}
                    <th>更新日時</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.records.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={loading ? -1 : 0}
                      role="button"
                      aria-label={`${detail.definition.layout.title}の行 ${String(row.values[fields[0]?.id] ?? "空欄")}`}
                      onClick={() => {
                        if (!loading) openRecord(row.id);
                      }}
                      onKeyDown={(e) => {
                        if (!loading && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          openRecord(row.id);
                        }
                      }}
                    >
                      {fields.map((f) => (
                        <td key={f.id}>
                          {displayLedgerValue(row.values[f.id])}
                        </td>
                      ))}
                      <td>{new Date(row.updatedAt).toLocaleString("ja-JP")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && !rows?.records.length && (
              <div className="empty">
                <h2>
                  {search
                    ? "条件に合う行がありません"
                    : "まだ行が登録されていません"}
                </h2>
                <p>
                  {search
                    ? "検索する文字を変えてください。"
                    : "新しい行から入力を始めてください。"}
                </p>
              </div>
            )}
            <div className="ledger-pagination">
              <span role="status">
                {loading
                  ? "読み込み中…"
                  : rows?.records.length
                    ? `${offset + 1}〜${offset + rows.records.length}行目`
                    : "0行"}
              </span>
              <button
                aria-label="台帳の前のページ"
                disabled={loading || !offset}
                onClick={() => setOffset((v) => Math.max(0, v - 50))}
              >
                前へ
              </button>
              <button
                aria-label="台帳の次のページ"
                disabled={loading || !rows?.hasMore}
                onClick={() => setOffset((v) => v + 50)}
              >
                次へ
              </button>
            </div>
          </>
        )}
      </main>
      {record && detail && (
        <LedgerRecordEditor
          key={`${record}:${draftId}:${detail.definition.version}:${retry}`}
          detail={detail}
          recordId={record}
          draftId={draftId}
          onClose={() => openRecord(undefined)}
          onDirty={onDirty}
          onSaved={(recordId) => {
            setNotice(recordId ? "台帳に保存しました。" : "行を削除しました。");
            openRecord(recordId || undefined, true);
            setRetry((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}
