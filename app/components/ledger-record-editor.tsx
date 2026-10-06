"use client";
import { useEffect, useState } from "react";
import {
  validateLedgerValues,
  type LedgerDetail,
  type LedgerRecord,
} from "@/lib/ledger-model";
import type { Value } from "@/lib/model";
import {
  displayLedgerValue,
  ledgerApi,
  LedgerValueInput,
  useDraftWarning,
} from "./ledger-ui";
export default function LedgerRecordEditor({
  detail,
  recordId,
  draftId,
  onClose,
  onSaved,
  onDirty,
}: {
  detail: LedgerDetail;
  recordId: string;
  draftId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const creating = recordId === "new";
  const { definition, space, capabilities } = detail,
    layout = definition.layout;
  const fields = layout.fields.filter((f) => !f.archived);
  const [original, setOriginal] = useState<LedgerRecord>(),
    [values, setValues] = useState<Record<string, Value>>(() =>
      creating
        ? Object.fromEntries(fields.map((f) => [f.id, f.defaultValue]))
        : {},
    ),
    [rowId] = useState(draftId || recordId),
    [ready, setReady] = useState(creating),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const initial = Object.fromEntries(
    fields.map((f) => [
      f.id,
      creating ? f.defaultValue : (original?.values[f.id] ?? null),
    ]),
  );
  const dirty = ready && JSON.stringify(values) !== JSON.stringify(initial);
  useDraftWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const controller = new AbortController();
    if (creating) {
      return;
    }
    ledgerApi<LedgerRecord>(
      { kind: "record", space: space.id, id: definition.id, record: recordId },
      undefined,
      controller.signal,
    )
      .then((record) => {
        setOriginal(record);
        setValues(
          Object.fromEntries(
            fields.map((f) => [f.id, record.values[f.id] ?? null]),
          ),
        );
        setReady(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
    // The panel is keyed by record and definition version in the table page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writable = creating ? capabilities.insert : capabilities.update;
  const sections = [...new Set(fields.map((f) => f.section))];
  const close = () => {
    if (busy) return;
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };
  async function save(remove = false) {
    setError("");
    try {
      const validated = remove
        ? {}
        : validateLedgerValues(layout, values, original?.values);
      setBusy(true);
      await ledgerApi(
        {},
        {
          action: remove ? "delete" : "record",
          space: space.id,
          id: definition.id,
          recordId: rowId,
          layoutVersion: definition.version,
          version: creating ? 0 : original!.version,
          ...(!remove ? { values: validated } : {}),
        },
      );
      onDirty(false);
      onSaved(remove ? "" : rowId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ledger-editor-overlay">
      <section
        className="ledger-record-panel"
        role="dialog"
        aria-modal="true"
        aria-label={creating ? "台帳に新しい行を登録" : "台帳の行明細"}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div className="dialog-title">
          <div>
            <small>{layout.title}</small>
            <h2>
              {creating
                ? "新しい行を登録"
                : writable
                  ? "明細を確認・入力"
                  : "明細を確認"}
            </h2>
          </div>
          <button disabled={busy} aria-label="行明細を閉じる" onClick={close}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          {!writable && (
            <p className="ledger-read-only">この台帳は閲覧のみです。</p>
          )}
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <p>
                入力内容はこの画面に残っています。更新状況を確認してから閉じてください。
              </p>
            </div>
          )}
          {!ready ? (
            <p role="status">行を読み込み中…</p>
          ) : (
            <form
              id="ledger-record-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (writable && !busy) void save();
              }}
            >
              {sections.map((section) => (
                <fieldset
                  key={section}
                  className={`ledger-form-section columns-${layout.columns}`}
                  disabled={busy}
                >
                  <legend>{section}</legend>
                  {fields
                    .filter((f) => f.section === section)
                    .map((field) => (
                      <label
                        key={field.id}
                        className={field.width === "full" ? "full-width" : ""}
                      >
                        <span>
                          {field.label}
                          {field.required && (
                            <small className="required-marker">必須</small>
                          )}
                          {field.readOnly && <small>参照のみ</small>}
                        </span>
                        {writable ? (
                          <LedgerValueInput
                            field={field}
                            value={values[field.id] ?? null}
                            onChange={(value) => {
                              setConfirmDiscard(false);
                              setValues((old) => ({
                                ...old,
                                [field.id]: value,
                              }));
                            }}
                          />
                        ) : (
                          <output aria-label={field.label}>
                            {displayLedgerValue(values[field.id])}
                          </output>
                        )}
                        {field.description && (
                          <small>{field.description}</small>
                        )}
                      </label>
                    ))}
                </fieldset>
              ))}
              {original && (
                <p className="muted">
                  更新 {new Date(original.updatedAt).toLocaleString("ja-JP")} ·{" "}
                  {original.updatedBy} · 版{original.version}
                </p>
              )}
            </form>
          )}
        </div>
        <div className="dialog-footer ledger-record-footer">
          {confirmDiscard ? (
            <>
              <p>未保存の変更を破棄して閉じます。</p>
              <button onClick={() => setConfirmDiscard(false)}>
                入力を続ける
              </button>
              <button onClick={onClose}>破棄して閉じる</button>
            </>
          ) : confirmDelete ? (
            <>
              <p>この行を削除します。</p>
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                削除をやめる
              </button>
              <button
                disabled={busy}
                className="danger"
                onClick={() => void save(true)}
              >
                {busy ? "削除中…" : "この行を削除"}
              </button>
            </>
          ) : (
            <>
              {!creating && capabilities.delete && ready && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  行を削除
                </button>
              )}
              <button disabled={busy} onClick={close}>
                閉じる
              </button>
              {writable && (
                <button
                  form="ledger-record-form"
                  type="submit"
                  className="primary"
                  disabled={!ready || busy || (!creating && !dirty)}
                >
                  {busy ? "保存中…" : creating ? "登録する" : "変更を保存"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
