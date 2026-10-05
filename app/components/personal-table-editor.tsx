"use client";
import { useState } from "react";
import { type PersonalTable } from "@/lib/model";
import {
  parsePastedTable,
  parsePersonalValue,
  validatePersonalTable,
} from "@/lib/personal";

export default function PersonalTableEditor({
  existing,
  onSave,
  onClose,
}: {
  existing?: PersonalTable;
  onSave: (table: PersonalTable) => Promise<void>;
  onClose: () => void;
}) {
  const [id] = useState(existing?.id || crypto.randomUUID());
  const [name, setName] = useState(existing?.name || "製品の個人分類");
  const [columns, setColumns] = useState<PersonalTable["columns"]>(
    existing?.columns || [
      { id: "c1", label: "製品", type: "TEXT" },
      { id: "c2", label: "個人分類", type: "TEXT" },
    ],
  );
  const [rows, setRows] = useState<string[][]>(
    existing?.rows.map((row) =>
      row.map((v) => (v === null ? "" : String(v))),
    ) || [["", ""]],
  );
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  function importPaste(text: string) {
    try {
      const data = parsePastedTable(text);
      setColumns(data.columns);
      setRows(
        data.rows.map((row) => row.map((v) => (v === null ? "" : String(v)))),
      );
      setPage(0);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const table = validatePersonalTable({
        id,
        name,
        columns,
        rows: rows.map((row, index) =>
          row.map((value, i) => {
            try {
              return parsePersonalValue(value, columns[i].type);
            } catch {
              throw Error(
                `${index + 1}行目「${columns[i].label}」は${columns[i].type}で入力してください。`,
              );
            }
          }),
        ),
        version: existing?.version || 1,
      });
      await onSave(table);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="dialog owner personal-editor fixed-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="個人テーブルを編集"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <div className="dialog-title">
          <div>
            <span className="eyebrow">PERSONAL TABLE</span>
            <h2>{existing ? "個人テーブルを編集" : "個人テーブルを作る"}</h2>
          </div>
          <button
            aria-label="個人テーブルを閉じる"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="muted">
            自分用の分類や目標値を作り、Snowflakeのデータに結合できます。最大1,000行・12列・500
            KB。
          </p>
          {existing && (
            <p className="muted">
              変更は、このテーブルを使う保存した表示にも反映されます。
            </p>
          )}
          <label>
            テーブル名
            <input
              aria-label="個人テーブル名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </label>
          <details>
            <summary>Excelなどからまとめて貼り付ける</summary>
            <p className="muted">
              先頭行は列名、区切りはタブ。先頭ゼロのある値は文字列として読み込みます。
            </p>
            <textarea
              aria-label="表を貼り付け"
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button onClick={() => importPaste(paste)}>
              貼り付けを読み込む
            </button>
          </details>
          <div className="personal-toolbar">
            <span>
              {rows.length}行 · {columns.length}列
            </span>
            <button
              onClick={() =>
                importPaste(
                  "製品\t個人分類\nアクリル樹脂 A-100\t重点製品\nエポキシ樹脂 E-200\t重点製品",
                )
              }
            >
              サンプルを入れる
            </button>
            <button
              disabled={columns.length >= 12}
              onClick={() => {
                const next =
                  Math.max(
                    0,
                    ...columns.map((c) => Number(c.id.replace(/^c/, "")) || 0),
                  ) + 1;
                setColumns([
                  ...columns,
                  { id: "c" + next, label: "列" + next, type: "TEXT" },
                ]);
                setRows(rows.map((row) => [...row, ""]));
              }}
            >
              ＋ 列
            </button>
            <button
              disabled={rows.length >= 1000}
              onClick={() => {
                setRows([...rows, columns.map(() => "")]);
                setPage(Math.floor(rows.length / 20));
              }}
            >
              ＋ 行
            </button>
          </div>
          <div className="personal-sheet">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  {columns.map((column, i) => (
                    <th key={column.id}>
                      <input
                        aria-label={`列${i + 1}の名前`}
                        value={column.label}
                        onChange={(e) =>
                          setColumns(
                            columns.map((c, j) =>
                              j === i ? { ...c, label: e.target.value } : c,
                            ),
                          )
                        }
                      />
                      <select
                        aria-label={`列${i + 1}の型`}
                        value={column.type}
                        onChange={(e) =>
                          setColumns(
                            columns.map((c, j) =>
                              j === i
                                ? {
                                    ...c,
                                    type: e.target.value as typeof c.type,
                                  }
                                : c,
                            ),
                          )
                        }
                      >
                        {[
                          ["TEXT", "文字列"],
                          ["NUMBER", "数値"],
                          ["DATE", "日付"],
                          ["BOOLEAN", "true / false"],
                        ].map(([value, text]) => (
                          <option key={value} value={value}>
                            {text}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={`列${i + 1}を削除`}
                        disabled={columns.length === 1}
                        onClick={() => {
                          setColumns(columns.filter((_, j) => j !== i));
                          setRows(
                            rows.map((row) => row.filter((_, j) => j !== i)),
                          );
                        }}
                      >
                        ×
                      </button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 20, (page + 1) * 20).map((row, offset) => {
                  const index = page * 20 + offset;
                  return (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      {columns.map((column, i) => (
                        <td key={column.id}>
                          <input
                            aria-label={`${index + 1}行目 ${column.label}`}
                            value={row[i]}
                            maxLength={2000}
                            onChange={(e) =>
                              setRows(
                                rows.map((r, j) =>
                                  j === index
                                    ? r.map((v, k) =>
                                        k === i ? e.target.value : v,
                                      )
                                    : r,
                                ),
                              )
                            }
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          aria-label={`${index + 1}行目を削除`}
                          onClick={() => {
                            setRows(rows.filter((_, j) => j !== index));
                            setPage(
                              Math.min(
                                page,
                                Math.max(0, Math.floor((rows.length - 2) / 20)),
                              ),
                            );
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="personal-toolbar">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              前の20行
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(rows.length / 20))}
            </span>
            <button
              disabled={(page + 1) * 20 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              次の20行
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button disabled={busy} onClick={onClose}>
            キャンセル
          </button>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "個人テーブルを保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
