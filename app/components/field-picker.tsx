"use client";
import { useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type Field, isNumeric } from "@/lib/model";
export default function FieldPicker({
  fields,
  recent,
  onChoose,
  onClose,
  title,
  onChooseMany,
}: {
  fields: Field[];
  recent: string[];
  onChoose: (f: Field) => void;
  onClose: () => void;
  title: string;
  onChooseMany?: (fields: Field[]) => void;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [category, setCategory] = useState("all"),
    [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const parent = useRef<HTMLDivElement>(null);
  const list = fields.filter(
    (f) =>
      `${f.id} ${f.label} ${f.description}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (type === "all" ||
        (type === "number"
          ? isNumeric(f)
          : type === "date"
            ? /DATE|TIME/.test(f.type)
            : !isNumeric(f) && !/DATE|TIME/.test(f.type))) &&
      (category === "all" || f.category === category) &&
      (scope === "all" ||
        (scope === "recent"
          ? recent.includes(f.id)
          : (f.recommended ?? f.suggested === "dimension"))),
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer owns measurements
  const virtual = useVirtualizer({
    count: list.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 78,
    overscan: 4,
  });
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="dialog-title">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <input
          autoFocus
          aria-label="項目を検索"
          placeholder="名前・説明で検索…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="picker-filters">
          <select
            aria-label="項目の型"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">すべての型</option>
            <option value="number">数値</option>
            <option value="date">日付</option>
            <option value="text">文字</option>
          </select>
          <select
            aria-label="項目カテゴリ"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">すべてのカテゴリ</option>
            {[...new Set(fields.map((f) => f.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="項目の候補"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">すべての項目</option>
            <option value="recommended">おすすめの行項目</option>
            <option value="recent">最近使った項目</option>
          </select>
        </div>
        <p className="muted">
          {list.length}項目 · 数値の項目も行として使えます
        </p>
        <div ref={parent} className="field-list">
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const f = list[v.index];
              return (
                <div
                  key={f.id}
                  className="field-option"
                  style={{
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${v.start}px)`,
                    height: v.size,
                    width: "100%",
                  }}
                >
                  {onChooseMany && (
                    <input
                      type="checkbox"
                      aria-label={`${f.label}を選択`}
                      checked={selected.includes(f.id)}
                      onChange={() =>
                        setSelected((ids) =>
                          ids.includes(f.id)
                            ? ids.filter((id) => id !== f.id)
                            : [...ids, f.id],
                        )
                      }
                    />
                  )}
                  <button
                    className="field-choice"
                    onClick={() => {
                      onChoose(f);
                      onClose();
                    }}
                  >
                    <span>
                      <strong>{f.label}</strong>
                      <small>
                        {f.id} · {f.type}
                      </small>
                    </span>
                    <span className="field-description">{f.description}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {!list.length && <p>一致する項目がありません。</p>}
        </div>
        {onChooseMany && selected.length > 0 && (
          <div className="dialog-footer">
            <button onClick={() => setSelected([])}>選択を解除</button>
            <button
              className="primary"
              onClick={() => {
                onChooseMany(fields.filter((f) => selected.includes(f.id)));
                onClose();
              }}
            >
              選んだ{selected.length}項目を追加
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
