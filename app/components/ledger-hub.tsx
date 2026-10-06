"use client";
import { DraftLink } from "./ledger-ui";
import { useEffect, useState } from "react";
import { useUrlState } from "./use-url-state";
import { ledgerHubHref, parseLedgerHubLocation } from "@/lib/ledger-location";
import type { LedgerSummary } from "@/lib/ledger-model";
import { LedgerHeader, ledgerApi, ledgerPath } from "./ledger-ui";
type Spaces = {
  mode: string;
  demoRole?: string;
  demoRoles?: { id: string; label: string }[];
  spaces: { id: string; label: string; canCreate: boolean }[];
};
export default function LedgerHub() {
  const [context, setContext] = useState<Spaces>(),
    [space, setSpace] = useState(""),
    [ledgers, setLedgers] = useState<LedgerSummary[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    ledgerApi<Spaces>({}, undefined, controller.signal)
      .then((value) => {
        setContext(value);
        if (!value.spaces.length) setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [retry]);
  useUrlState(
    { space: space || undefined },
    {
      ready: !!context,
      parse: parseLedgerHubLocation,
      format: ledgerHubHref,
      apply: async (value) => {
        const selected = value.space || context?.spaces[0]?.id || "";
        if (value.space && !context?.spaces.some((s) => s.id === value.space))
          throw Error("この部署の台帳は現在の権限では利用できません。");
        setSpace(selected);
        setLedgers([]);
        setLoading(!!selected);
        setError("");
      },
      onError: (error) => {
        setSpace("");
        setLedgers([]);
        setLoading(false);
        setError(error.message);
      },
    },
  );
  useEffect(() => {
    if (!space) return;
    const controller = new AbortController();
    ledgerApi<LedgerSummary[]>(
      { kind: "list", space },
      undefined,
      controller.signal,
    )
      .then((value) => {
        setLedgers(value);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLedgers([]);
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [space, retry]);
  const selected = context?.spaces.find((s) => s.id === space);
  return (
    <div className="app-shell">
      <LedgerHeader />
      <main className="ledger-hub">
        <div className="ledger-page-heading">
          <div>
            <p className="eyebrow">部署で共有する入力</p>
            <h1>台帳に入力</h1>
            <p className="muted">
              表から行を開き、明細を確認して入力します。入力者は共通の項目と配置も変更できます。
            </p>
          </div>
          {selected?.canCreate && (
            <DraftLink
              className="button-link primary"
              href={ledgerPath(space, "new")}
            >
              台帳を作る
            </DraftLink>
          )}
        </div>
        {context?.mode === "mock" && (
          <div className="ledger-demo">
            <span>デモの権限を確認</span>
            <select
              aria-label="台帳のデモロール"
              value={context.demoRole}
              onChange={async (e) => {
                try {
                  await ledgerApi(
                    {},
                    { action: "demo_role", role: e.target.value },
                  );
                  window.history.replaceState(
                    window.history.state,
                    "",
                    "/ledgers",
                  );
                  setContext(undefined);
                  setSpace("");
                  setLedgers([]);
                  setLoading(true);
                  setRetry((r) => r + 1);
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              {context.demoRoles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
            <small>
              この切り替えはデモ用です。本番は本人のSnowflakeロールで判定します。
            </small>
          </div>
        )}
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              onClick={() => {
                setError("");
                setLoading(true);
                setRetry((r) => r + 1);
              }}
            >
              再読み込み
            </button>
          </div>
        )}
        {context?.spaces.length ? (
          <div className="ledger-space-picker">
            <label>
              部署
              <select
                aria-label="台帳の部署"
                value={space}
                onChange={(e) => {
                  setSpace(e.target.value);
                  setLedgers([]);
                  setLoading(true);
                  setError("");
                }}
              >
                {context.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {selected?.canCreate ? "入力・共通レイアウト編集" : "閲覧のみ"}
            </span>
          </div>
        ) : (
          !loading && (
            <div className="empty">
              <h2>利用できる台帳の部署がありません</h2>
              <p>管理者に部署のロールと台帳の設定を確認してください。</p>
            </div>
          )
        )}
        {loading ? (
          <p role="status">台帳を読み込み中…</p>
        ) : (
          <div className="ledger-cards">
            {ledgers.map((ledger) => (
              <DraftLink
                key={ledger.id}
                href={ledgerPath(space, ledger.id)}
                className="ledger-card"
              >
                <span className="eyebrow">{selected?.label}</span>
                <h2>{ledger.title}</h2>
                <p>{ledger.description}</p>
                <small>{ledger.fieldCount}項目 · 表から明細を開く</small>
              </DraftLink>
            ))}
          </div>
        )}
        {!loading && space && !ledgers.length && !error && (
          <div className="empty">
            <h2>台帳はまだありません</h2>
            <p>
              {selected?.canCreate
                ? "台帳を作り、部署で使う項目を選んでください。"
                : "入力者に台帳の作成を依頼してください。"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
