"use client";
import { useState } from "react";
import { useDraftWarning } from "./ledger-ui";
import type { Field, FieldOverride } from "@/lib/model";

export default function PersonalFieldsEditor({
  fields,
  overrides,
  onApply,
  onClose,
}: {
  fields: Field[];
  overrides: FieldOverride[];
  onApply: (values: FieldOverride[]) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() =>
    fields.map((field) => {
      const value = overrides.find((f) => f.id === field.id);
      return {
        id: field.id,
        label: value?.label || field.label,
        description: value?.description ?? field.description,
      };
    }),
  );
  const [search, setSearch] = useState("");
  const visible = values.filter((v) =>
    (v.id + " " + v.label + " " + v.description)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const [baseline] = useState(() => JSON.stringify(values));
  const dirty = JSON.stringify(values) !== baseline;
  const clearWarning = useDraftWarning(dirty);
  function close() {
    if (dirty && !window.confirm("未反映の項目名を破棄して閉じますか？"))
      return;
    clearWarning();
    onClose();
  }
  return (
    <div className="overlay">
      <section
        className="dialog owner fixed-dialog personal-fields"
        role="dialog"
        aria-modal="true"
        aria-label="個人用の項目名を編集"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div className="dialog-title">
          <h2>個人用の項目名と説明</h2>
          <button aria-label="項目名の編集を閉じる" onClick={close}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            この分析で使う名前と説明を変えます。「表示を保存」で、自分用の定義として残せます。
          </p>
          <input
            aria-label="個人用の項目を検索"
            placeholder="項目名・説明を検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="personal-field-list">
            {visible.map((v) => (
              <div className="personal-field-row" key={v.id}>
                <code>{v.id}</code>
                <label>
                  表示名
                  <input
                    aria-label={`${v.id}の個人表示名`}
                    maxLength={120}
                    value={v.label}
                    onChange={(e) =>
                      setValues(
                        values.map((old) =>
                          old.id === v.id
                            ? { ...old, label: e.target.value }
                            : old,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  説明
                  <textarea
                    aria-label={`${v.id}の個人説明`}
                    maxLength={1000}
                    rows={2}
                    value={v.description}
                    onChange={(e) =>
                      setValues(
                        values.map((old) =>
                          old.id === v.id
                            ? { ...old, description: e.target.value }
                            : old,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-footer">
          <button
            onClick={() =>
              setValues(
                fields.map(({ id, label, description }) => ({
                  id,
                  label,
                  description,
                })),
              )
            }
          >
            元の名前に戻す
          </button>
          <button onClick={close}>キャンセル</button>
          <button
            className="primary"
            disabled={values.some((v) => !v.label.trim())}
            onClick={() => {
              clearWarning();
              onApply(
                values.filter((v) => {
                  const original = fields.find((f) => f.id === v.id)!;
                  return (
                    v.label !== original.label ||
                    v.description !== original.description
                  );
                }),
              );
              onClose();
            }}
          >
            この分析に反映
          </button>
        </div>
      </section>
    </div>
  );
}
