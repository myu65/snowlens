"use client";
import { useState } from "react";
import type { Dataset, QueryableSource } from "@/lib/model";
import CatalogBrowser from "./catalog-browser";
export default function FactMappingEditor({
  source,
  sources,
  value,
  onChange,
}: {
  source: QueryableSource;
  sources: QueryableSource[];
  value?: Dataset["factDetail"];
  onChange: (value: Dataset["factDetail"]) => void;
}) {
  const [target, setTarget] = useState<QueryableSource>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function select(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/catalog?source=" + encodeURIComponent(id),
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      const next = data as QueryableSource;
      if (next.kind === "semantic_view")
        throw Error("Table / View / Dynamic Tableを選んでください。");
      setTarget(next);
      if (value?.source !== next.id)
        onChange({
          source: next.id,
          fields: next.fields.map((f) => f.id),
          mapping: {},
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h3>元データの明細</h3>
      <p className="muted">
        利用者自身にSELECT権限のある明細元を指定します。すべての検索条件と選んだ行の項目に対応づけが必要です。
      </p>
      {value && (
        <p>
          設定済み: {value.source}
          <button onClick={() => void select(value.source)}>
            設定を読み込む
          </button>
          <button
            onClick={() => {
              setTarget(undefined);
              onChange(undefined);
            }}
          >
            連携を解除
          </button>
        </p>
      )}
      <select
        aria-label="明細元"
        value={target?.id || ""}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) void select(e.target.value);
        }}
      >
        <option value="">明細元を選ぶ</option>
        {sources
          .filter((s) => s.kind !== "semantic_view")
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.database}.{s.schema}.{s.name}
            </option>
          ))}
      </select>
      {!sources.length && <CatalogBrowser onOpen={(s) => void select(s.id)} />}
      {busy && <p role="status">項目を読み込み中…</p>}
      {error && <p role="alert">{error}</p>}
      {target && value && (
        <>
          {source.fields
            .filter((f) => f.semantic === "dimension")
            .map((f) => (
              <label key={f.id}>
                {f.label}
                <select
                  aria-label={`${f.id}の明細対応`}
                  value={value.mapping[f.id] || ""}
                  onChange={(e) => {
                    const mapping = { ...value.mapping };
                    if (e.target.value) mapping[f.id] = e.target.value;
                    else delete mapping[f.id];
                    onChange({ ...value, mapping });
                  }}
                >
                  <option value="">対応なし</option>
                  {target.fields.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} · {t.type}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          <h4>明細で表示する項目</h4>
          <div className="owner-fields">
            {target.fields.map((f) => (
              <label key={f.id}>
                <input
                  type="checkbox"
                  aria-label={`${f.id}を明細に表示`}
                  checked={value.fields.includes(f.id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      fields: e.target.checked
                        ? [...value.fields, f.id]
                        : value.fields.filter((id) => id !== f.id),
                    })
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
