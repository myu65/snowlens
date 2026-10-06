"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import Link from "next/link";
import type { LedgerField } from "@/lib/ledger-model";
import type { Value } from "@/lib/model";

export async function ledgerApi<T>(
  params: Record<string, string>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/ledgers?" + new URLSearchParams(params), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!response.ok)
    throw Object.assign(new Error(data.error || "台帳を読み込めません。"), {
      status: response.status,
    });
  return data;
}
export function ledgerPath(space: string, id?: string) {
  return (
    "/ledgers/" +
    encodeURIComponent(space) +
    (id ? "/" + encodeURIComponent(id) : "")
  );
}
export function displayLedgerValue(value: Value | undefined) {
  return value == null || value === ""
    ? "—"
    : typeof value === "boolean"
      ? value
        ? "はい"
        : "いいえ"
      : typeof value === "number"
        ? value.toLocaleString("ja-JP", { maximumFractionDigits: 4 })
        : value;
}
export function useDraftWarning(dirty: boolean) {
  const armed = useRef(dirty);
  useEffect(() => {
    armed.current = dirty;
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!armed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    const navigate = (event: Event) => {
      if (
        armed.current &&
        !window.confirm("未保存の変更を破棄して画面を移動しますか？")
      )
        event.preventDefault();
    };
    window.addEventListener("snowlens-leave-draft", navigate);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("snowlens-leave-draft", navigate);
    };
  }, [dirty]);
  return () => {
    armed.current = false;
  };
}
export function DraftLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (
          !window.dispatchEvent(
            new Event("snowlens-leave-draft", { cancelable: true }),
          )
        )
          event.preventDefault();
      }}
    />
  );
}
export function LedgerHeader({
  space,
  title,
}: {
  space?: string;
  title?: string;
}) {
  return (
    <header className="topbar ledger-topbar">
      <DraftLink className="brand" href="/">
        <span className="brand-icon">❄</span>SnowLens
      </DraftLink>
      <nav className="workspace-nav" aria-label="機能を選ぶ">
        <DraftLink href="/">データを見る</DraftLink>
        <DraftLink href="/ledgers" aria-current="page">
          台帳に入力
        </DraftLink>
      </nav>
      <span className="ledger-context">
        {space}
        {title ? ` / ${title}` : ""}
      </span>
    </header>
  );
}
export function LedgerValueInput({
  field,
  value,
  onChange,
  label,
}: {
  field: LedgerField;
  value: Value;
  onChange: (value: Value) => void;
  label?: string;
}) {
  const name = label || field.label;
  if (field.readOnly)
    return <output aria-label={name}>{displayLedgerValue(value)}</output>;
  if (field.type === "boolean")
    return (
      <select
        aria-label={name}
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "true")
        }
      >
        <option value="">未指定</option>
        <option value="true">はい</option>
        <option value="false">いいえ</option>
      </select>
    );
  if (field.options.length)
    return (
      <select
        aria-label={name}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">選んでください</option>
        {value && !field.options.includes(String(value)) && (
          <option value={String(value)}>
            {String(value)}（現在の選択肢にありません）
          </option>
        )}
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  const props = {
    "aria-label": name,
    value: String(value ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(
        e.target.value === ""
          ? null
          : field.type === "number"
            ? Number(e.target.value)
            : e.target.value,
      ),
  };
  return field.type === "text" && field.multiline ? (
    <textarea {...props} maxLength={2000} rows={3} />
  ) : (
    <input
      {...props}
      type={
        field.type === "number"
          ? "number"
          : field.type === "date"
            ? "date"
            : "text"
      }
      step={field.type === "number" ? "0.0001" : undefined}
      maxLength={field.type === "text" ? 2000 : undefined}
    />
  );
}
