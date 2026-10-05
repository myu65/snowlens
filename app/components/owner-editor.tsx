"use client";
import { useState } from "react";
import { type QueryableSource, type Query, type Dataset } from "@/lib/model";
import FactMappingEditor from "./fact-mapping-editor";
export default function OwnerEditor({
  source,
  sources,
  query,
  existing,
  onPublish,
  onClose,
}: {
  source: QueryableSource;
  sources: QueryableSource[];
  query: Query;
  existing?: Dataset;
  onPublish: (d: Dataset) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(
      existing?.name || source.description || source.name,
    ),
    [description, setDescription] = useState(existing?.description || ""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(
    existing?.fields ||
      source.fields.map((f) => ({
        id: f.id,
        label: f.label,
        description: f.description,
        recommended: f.suggested === "dimension",
      })),
  );
  const [drill, setDrill] = useState(
    existing?.drill ||
      Object.fromEntries(
        query.dimensions.map((d) => [
          d,
          source.fields
            .filter((f) => f.suggested === "dimension" && f.id !== d)
            .slice(0, 3)
            .map((f) => f.id),
        ]),
      ),
  );
  const [factDetail, setFactDetail] = useState(existing?.factDetail);
  async function publish() {
    setBusy(true);
    setError("");
    try {
      await onPublish({
        id: existing?.id || crypto.randomUUID(),
        name,
        description,
        source: source.id,
        fields,
        defaultView: query,
        drill,
        ...(factDetail ? { factDetail } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "公開できません");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="dialog owner"
        role="dialog"
        aria-modal="true"
        aria-label="Datasetを公開"
      >
        <div className="dialog-title">
          <div>
            <span className="eyebrow">DATASET OWNER</span>
            <h2>使いやすい定義として公開</h2>
          </div>
          <button onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <p className="muted">
          元データ: {source.name} ·
          現在の行・値・条件を初期表示として保存します。
        </p>
        <label>
          Dataset名
          <input
            aria-label="Dataset名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          説明
          <textarea
            aria-label="Dataset説明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <h3>公開する項目</h3>
        <p className="muted">
          名前・説明は必要な項目だけ整えれば公開できます。推奨は利用者への候補です。
        </p>
        <input
          aria-label="公開項目を検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="項目を検索…"
        />
        <div className="owner-fields">
          {source.fields
            .filter((f) =>
              (f.label + " " + f.id)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((f) => {
              const selected = fields.find((x) => x.id === f.id);
              return (
                <div className="owner-field" key={f.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${f.id}を公開`}
                      checked={!!selected}
                      onChange={(e) =>
                        setFields(
                          e.target.checked
                            ? [
                                ...fields,
                                {
                                  id: f.id,
                                  label: f.label,
                                  description: f.description,
                                  recommended: false,
                                },
                              ]
                            : fields.filter((x) => x.id !== f.id),
                        )
                      }
                    />
                    <span>
                      {f.id}
                      <small>{f.type}</small>
                    </span>
                  </label>
                  {selected && (
                    <>
                      <input
                        aria-label={`${f.id}表示名`}
                        value={selected.label}
                        onChange={(e) =>
                          setFields(
                            fields.map((x) =>
                              x.id === f.id
                                ? { ...x, label: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`${f.id}説明`}
                        value={selected.description}
                        onChange={(e) =>
                          setFields(
                            fields.map((x) =>
                              x.id === f.id
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${f.id}を推奨`}
                          checked={selected.recommended}
                          onChange={(e) =>
                            setFields(
                              fields.map((x) =>
                                x.id === f.id
                                  ? { ...x, recommended: e.target.checked }
                                  : x,
                              ),
                            )
                          }
                        />
                        推奨
                      </label>
                    </>
                  )}
                </div>
              );
            })}
        </div>
        <h3>掘り下げの候補</h3>
        {query.dimensions.length ? (
          query.dimensions.map((id) => (
            <label key={id}>
              {source.fields.find((f) => f.id === id)?.label}
              <select
                multiple
                aria-label={`${id}の掘り下げ候補`}
                value={drill[id] || []}
                onChange={(e) =>
                  setDrill({
                    ...drill,
                    [id]: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                  })
                }
              >
                {fields
                  .filter(
                    (f) =>
                      f.id !== id &&
                      source.fields.find((sf) => sf.id === f.id)?.semantic !==
                        "metric",
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </label>
          ))
        ) : (
          <p className="muted">
            行のグループ化を選ぶと掘り下げ候補も設定できます。
          </p>
        )}
        {source.kind === "semantic_view" && (
          <FactMappingEditor
            source={{
              ...source,
              fields: source.fields.filter((f) =>
                fields.some((x) => x.id === f.id),
              ),
            }}
            sources={sources}
            value={factDetail}
            onChange={setFactDetail}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            disabled={busy || !name.trim() || !fields.length}
            onClick={publish}
          >
            {busy ? "公開中…" : "公開する"}
          </button>
        </div>
      </section>
    </div>
  );
}
