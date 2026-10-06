"use client";
import { DraftLink } from "./ledger-ui";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ledgerFieldSchema,
  ledgerTypes,
  newLedgerField,
  validateLedgerLayout,
  type LedgerDetail,
  type LedgerField,
  type LedgerLayout,
  type LedgerType,
} from "@/lib/ledger-model";
import {
  LedgerHeader,
  displayLedgerValue,
  ledgerApi,
  ledgerPath,
  useDraftWarning,
} from "./ledger-ui";
const typeLabels: Record<LedgerType, string> = {
  text: "文字列",
  number: "数値",
  date: "日付",
  boolean: "はい・いいえ",
};
function initialLayout(): LedgerLayout {
  const first = ledgerFieldSchema.parse({
    id: "T_01",
    label: "名称",
    type: "text",
    required: true,
    width: "full",
  });
  const second = ledgerFieldSchema.parse({
    id: "T_02",
    label: "メモ",
    type: "text",
    width: "full",
    multiline: true,
  });
  return validateLedgerLayout({
    title: "新しい台帳",
    description: "",
    columns: 2,
    fields: [first, second],
    tableColumns: [first.id, second.id],
  });
}
export default function LedgerDesigner({
  spaceId,
  id,
}: {
  spaceId: string;
  id?: string;
}) {
  const router = useRouter();
  const [optionsText, setOptionsText] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<LedgerDetail>(),
    [layout, setLayout] = useState<LedgerLayout>(initialLayout),
    [baseline, setBaseline] = useState<LedgerLayout>(initialLayout),
    [ready, setReady] = useState(false),
    [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [addingType, setAddingType] = useState<LedgerType>("text"),
    [dragging, setDragging] = useState<string>(),
    [spaceLabel, setSpaceLabel] = useState(""),
    [conflict, setConflict] = useState(false),
    [creationId] = useState(() => crypto.randomUUID());
  const sectionList = useId(),
    dirty = JSON.stringify(layout) !== JSON.stringify(baseline);
  const clearDraftWarning = useDraftWarning(dirty);
  useEffect(() => {
    const controller = new AbortController();
    const task = id
      ? ledgerApi<LedgerDetail>(
          { kind: "detail", space: spaceId, id },
          undefined,
          controller.signal,
        ).then((d) => {
          setDetail(d);
          setSpaceLabel(d.space.label);
          setLayout(d.definition.layout);
          setBaseline(d.definition.layout);
          setAllowed(d.capabilities.layout);
          setReady(true);
        })
      : ledgerApi<{
          spaces: { id: string; label: string; canCreate: boolean }[];
        }>({}, undefined, controller.signal).then((context) => {
          const space = context.spaces.find((s) => s.id === spaceId);
          if (!space) throw Error("この部署の台帳は利用できません。");
          setAllowed(space.canCreate);
          setSpaceLabel(space.label);
          setReady(true);
        });
    task.catch((e) => {
      if (!controller.signal.aborted) {
        setError(e.message);
        setAllowed(false);
        setReady(true);
      }
    });
    return () => controller.abort();
  }, [id, spaceId]);
  const patchField = (index: number, patch: Partial<LedgerField>) =>
    setLayout((old) => ({
      ...old,
      fields: old.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= layout.fields.length) return;
    setLayout((old) => {
      const fields = [...old.fields],
        field = fields.splice(from, 1)[0];
      fields.splice(to, 0, field);
      return { ...old, fields };
    });
  };
  const sections = [
    ...new Set(layout.fields.filter((f) => !f.archived).map((f) => f.section)),
  ];
  async function save() {
    setError("");
    setConflict(false);
    try {
      const validated = validateLedgerLayout(layout, id ? baseline : undefined);
      setBusy(true);
      const result = await ledgerApi<{ id: string }>(
        {},
        {
          action: id ? "layout" : "create",
          space: spaceId,
          id: id || creationId,
          ...(id ? { version: detail!.definition.version } : {}),
          layout: validated,
        },
      );
      setBaseline(validated);
      clearDraftWarning();
      router.push(ledgerPath(spaceId, result.id));
    } catch (e) {
      setError(
        (e as Error).name === "ZodError"
          ? "台帳名・項目名・一覧の項目を確認してください。"
          : (e as Error).message,
      );
      setConflict((e as { status?: number }).status === 409);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <LedgerHeader space={spaceLabel} />
      <main className="ledger-design-page">
        <DraftLink
          className="back-link"
          href={id ? ledgerPath(spaceId, id) : "/ledgers"}
        >
          ← {id ? "台帳に戻る" : "台帳一覧"}
        </DraftLink>
        <div className="ledger-page-heading">
          <div>
            <p className="eyebrow">共通の項目と配置</p>
            <h1>{id ? "項目とレイアウト" : "台帳を作る"}</h1>
            <p className="muted">
              同じ部署の入力者と共有します。表示から外した項目の値は残ります。
            </p>
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            {conflict && (
              <p>
                この画面の変更は残っています。必要な変更を控えてからページを読み直してください。
              </p>
            )}
          </div>
        )}
        {!ready ? (
          <p role="status">レイアウトを読み込み中…</p>
        ) : !allowed ? (
          <div className="empty">
            <h2>この画面は参照のみです</h2>
            <p>入力と共通レイアウトを編集する権限を確認してください。</p>
          </div>
        ) : (
          <>
            <div className="ledger-design-grid">
              <div className="ledger-design-controls">
                <label className="ledger-title-input">
                  台帳名
                  <input
                    aria-label="台帳名"
                    maxLength={120}
                    value={layout.title}
                    onChange={(e) =>
                      setLayout((v) => ({ ...v, title: e.target.value }))
                    }
                  />
                </label>
                <label className="ledger-title-input">
                  台帳の説明
                  <textarea
                    aria-label="台帳の説明"
                    maxLength={1000}
                    value={layout.description}
                    onChange={(e) =>
                      setLayout((v) => ({ ...v, description: e.target.value }))
                    }
                  />
                </label>
                <label className="ledger-title-input">
                  フォームの列数
                  <select
                    aria-label="フォームの列数"
                    value={layout.columns}
                    onChange={(e) =>
                      setLayout((v) => ({
                        ...v,
                        columns: Number(e.target.value) as 1 | 2,
                      }))
                    }
                  >
                    <option value={1}>1列</option>
                    <option value={2}>2列</option>
                  </select>
                </label>
                <datalist id={sectionList}>
                  {sections.map((section) => (
                    <option key={section} value={section} />
                  ))}
                </datalist>
                <h2>項目を組み立てる</h2>
                <p className="muted">
                  項目の見出しをドラッグするか、上下ボタンで順番を変えます。保存後は同じ部署の利用者に反映されます。
                </p>
                <div className="ledger-design-fields">
                  {layout.fields.map((field, index) => (
                    <fieldset
                      key={field.id}
                      className={`ledger-field-design ${field.archived ? "archived" : ""}`}
                      disabled={busy}
                      onDragOver={(e) => {
                        if (dragging) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = layout.fields.findIndex(
                          (f) =>
                            f.id ===
                            e.dataTransfer.getData(
                              "application/x-snowlens-ledger-field",
                            ),
                        );
                        if (from >= 0) reorder(from, index);
                        setDragging(undefined);
                      }}
                    >
                      <div className="ledger-field-heading">
                        <button
                          type="button"
                          draggable
                          aria-label={`項目${index + 1}をドラッグで移動`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "application/x-snowlens-ledger-field",
                              field.id,
                            );
                            setDragging(field.id);
                          }}
                          onDragEnd={() => setDragging(undefined)}
                        >
                          ⋮⋮
                        </button>
                        <strong>
                          {index + 1}. {field.label}
                        </strong>
                        <span>{typeLabels[field.type]}</span>
                        <button
                          aria-label={`項目${index + 1}を上へ`}
                          disabled={index === 0 || busy}
                          onClick={() => reorder(index, index - 1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`項目${index + 1}を下へ`}
                          disabled={index === layout.fields.length - 1 || busy}
                          onClick={() => reorder(index, index + 1)}
                        >
                          ↓
                        </button>
                      </div>
                      <div className="ledger-field-properties">
                        <label>
                          項目名
                          <input
                            aria-label={`項目${index + 1}の名前`}
                            maxLength={120}
                            value={field.label}
                            onChange={(e) =>
                              patchField(index, { label: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          セクション
                          <input
                            aria-label={`項目${index + 1}のセクション`}
                            list={sectionList}
                            maxLength={80}
                            value={field.section}
                            onChange={(e) =>
                              patchField(index, { section: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          幅
                          <select
                            aria-label={`項目${index + 1}の幅`}
                            value={field.width}
                            onChange={(e) =>
                              patchField(index, {
                                width: e.target.value as LedgerField["width"],
                              })
                            }
                          >
                            <option value="half">1列分</option>
                            <option value="full">横幅いっぱい</option>
                          </select>
                        </label>
                        <label>
                          説明
                          <input
                            aria-label={`項目${index + 1}の説明`}
                            maxLength={500}
                            value={field.description}
                            onChange={(e) =>
                              patchField(index, { description: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <div className="ledger-field-flags">
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`項目${index + 1}を必須にする`}
                            checked={field.required}
                            onChange={(e) =>
                              patchField(index, { required: e.target.checked })
                            }
                          />
                          必須
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`項目${index + 1}を参照のみにする`}
                            checked={field.readOnly}
                            onChange={(e) =>
                              patchField(index, { readOnly: e.target.checked })
                            }
                          />
                          参照のみ
                        </label>
                        {field.type === "text" && (
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`項目${index + 1}を複数行で入力する`}
                              checked={field.multiline}
                              onChange={(e) =>
                                patchField(index, {
                                  multiline: e.target.checked,
                                })
                              }
                            />
                            複数行で入力
                          </label>
                        )}
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`項目${index + 1}を非表示にする`}
                            checked={field.archived}
                            onChange={(e) => {
                              const archived = e.target.checked;
                              patchField(index, { archived });
                              if (archived)
                                setLayout((old) => ({
                                  ...old,
                                  tableColumns: old.tableColumns.filter(
                                    (column) => column !== field.id,
                                  ),
                                }));
                            }}
                          />
                          非表示（値を残す）
                        </label>
                      </div>
                      {field.type === "text" && (
                        <label className="ledger-title-input">
                          選択肢（1行に1つ。空欄なら自由入力）
                          <textarea
                            aria-label={`項目${index + 1}の選択肢`}
                            value={
                              optionsText[field.id] ?? field.options.join("\n")
                            }
                            onChange={(e) => {
                              setOptionsText((old) => ({
                                ...old,
                                [field.id]: e.target.value,
                              }));
                              patchField(index, {
                                options: e.target.value
                                  .split("\n")
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              });
                            }}
                          />
                        </label>
                      )}
                      <label className="ledger-title-input">
                        新しい行の初期値
                        {field.type === "boolean" ? (
                          <select
                            aria-label={`項目${index + 1}の初期値`}
                            value={
                              field.defaultValue === null
                                ? ""
                                : String(field.defaultValue)
                            }
                            onChange={(e) =>
                              patchField(index, {
                                defaultValue:
                                  e.target.value === ""
                                    ? null
                                    : e.target.value === "true",
                              })
                            }
                          >
                            <option value="">未指定</option>
                            <option value="true">はい</option>
                            <option value="false">いいえ</option>
                          </select>
                        ) : (
                          <input
                            aria-label={`項目${index + 1}の初期値`}
                            type={
                              field.type === "number"
                                ? "number"
                                : field.type === "date"
                                  ? "date"
                                  : "text"
                            }
                            step={
                              field.type === "number" ? "0.0001" : undefined
                            }
                            value={String(field.defaultValue ?? "")}
                            onChange={(e) =>
                              patchField(index, {
                                defaultValue:
                                  e.target.value === ""
                                    ? null
                                    : field.type === "number"
                                      ? Number(e.target.value)
                                      : e.target.value,
                              })
                            }
                          />
                        )}
                      </label>
                      {!id ||
                      !baseline.fields.some((f) => f.id === field.id) ? (
                        <button
                          className="danger"
                          aria-label={`項目${index + 1}を取り消す`}
                          onClick={() =>
                            setLayout((old) => ({
                              ...old,
                              fields: old.fields.filter(
                                (f) => f.id !== field.id,
                              ),
                              tableColumns: old.tableColumns.filter(
                                (column) => column !== field.id,
                              ),
                            }))
                          }
                        >
                          追加を取り消す
                        </button>
                      ) : (
                        <small>
                          型は保存済みの値を保つため固定です。違う型が必要なら項目を追加します。
                        </small>
                      )}
                    </fieldset>
                  ))}
                </div>
                <div className="ledger-add-field">
                  <select
                    aria-label="追加する項目の型"
                    value={addingType}
                    onChange={(e) =>
                      setAddingType(e.target.value as LedgerType)
                    }
                  >
                    {ledgerTypes.map((type) => (
                      <option key={type} value={type}>
                        {typeLabels[type]}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || layout.fields.length >= 50}
                    onClick={() => {
                      try {
                        const field = newLedgerField(layout.fields, addingType);
                        setLayout((old) => ({
                          ...old,
                          fields: [...old.fields, field],
                        }));
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    ＋ 項目を追加
                  </button>
                </div>
                <h2>一覧に表示する項目</h2>
                <div className="ledger-list-columns">
                  {layout.fields
                    .filter((f) => !f.archived)
                    .map((field) => (
                      <label key={field.id}>
                        <input
                          type="checkbox"
                          aria-label={`一覧に${field.label}を表示`}
                          checked={layout.tableColumns.includes(field.id)}
                          onChange={(e) =>
                            setLayout((old) => ({
                              ...old,
                              tableColumns: e.target.checked
                                ? [...old.tableColumns, field.id]
                                : old.tableColumns.filter(
                                    (column) => column !== field.id,
                                  ),
                            }))
                          }
                        />
                        {field.label}
                      </label>
                    ))}
                </div>
                <ol className="ledger-column-order">
                  {layout.tableColumns.map((column, index) => (
                    <li key={column}>
                      <span>
                        {layout.fields.find((f) => f.id === column)?.label}
                      </span>
                      <button
                        aria-label={`一覧の列${index + 1}を上へ`}
                        disabled={index === 0}
                        onClick={() =>
                          setLayout((old) => {
                            const columns = [...old.tableColumns];
                            [columns[index - 1], columns[index]] = [
                              columns[index],
                              columns[index - 1],
                            ];
                            return { ...old, tableColumns: columns };
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`一覧の列${index + 1}を下へ`}
                        disabled={index === layout.tableColumns.length - 1}
                        onClick={() =>
                          setLayout((old) => {
                            const columns = [...old.tableColumns];
                            [columns[index + 1], columns[index]] = [
                              columns[index],
                              columns[index + 1],
                            ];
                            return { ...old, tableColumns: columns };
                          })
                        }
                      >
                        ↓
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
              <aside
                className="ledger-form-preview"
                aria-label="入力フォームのプレビュー"
              >
                <div>
                  <p className="eyebrow">入力フォームのプレビュー</p>
                  <h2>{layout.title}</h2>
                  <p className="muted">{layout.description}</p>
                </div>
                {sections.map((section) => (
                  <fieldset
                    key={section}
                    className={`ledger-form-section columns-${layout.columns}`}
                  >
                    <legend>{section}</legend>
                    {layout.fields
                      .filter((f) => !f.archived && f.section === section)
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
                          </span>
                          <div className="ledger-preview-value">
                            {field.defaultValue !== null
                              ? displayLedgerValue(field.defaultValue)
                              : typeLabels[field.type]}
                          </div>
                          {field.description && (
                            <small>{field.description}</small>
                          )}
                        </label>
                      ))}
                  </fieldset>
                ))}
              </aside>
            </div>
            <div className="ledger-design-footer">
              <span>
                {dirty
                  ? "共通レイアウトに未保存の変更があります"
                  : id
                    ? "現在の共通レイアウト"
                    : "項目を確認して台帳を作成します"}
              </span>
              <DraftLink
                className="button-link"
                href={id ? ledgerPath(spaceId, id) : "/ledgers"}
              >
                戻る
              </DraftLink>
              <button
                className="primary"
                disabled={busy || (!!id && !dirty)}
                onClick={() => void save()}
              >
                {busy ? "保存中…" : id ? "共通レイアウトを保存" : "台帳を作成"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
