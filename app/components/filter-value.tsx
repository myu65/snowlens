"use client";
import { useEffect, useId, useState } from "react";
import type { Field, Query, Result, Value } from "@/lib/model";
import { isNumeric } from "@/lib/model";

export default function FilterValue({
  field,
  query,
  index,
  datasetId,
  onChange,
}: {
  field?: Field;
  query: Query;
  index: number;
  datasetId?: string;
  onChange: (value: Value) => void;
}) {
  const id = useId();
  const filter = query.filters[index];
  const [choices, setChoices] = useState<Value[]>([]);
  const [message, setMessage] = useState("");
  const [loadedContext, setLoadedContext] = useState("");
  const [requested, setRequested] = useState(false);
  const boolean = field?.type === "BOOLEAN";
  const date = !!field && /DATE|TIME/.test(field.type);
  const context = JSON.stringify([
    query.source,
    query.filters.filter((_, i) => i !== index),
    datasetId,
    filter.field,
  ]);
  useEffect(() => {
    if (!requested || date || boolean) return;
    const controller = new AbortController();
    const [source, filters, dataset, column] = JSON.parse(context);
    void fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        datasetId: dataset ?? undefined,
        query: {
          source,
          filters,
          dimensions: [column],
          metrics: [],
          detail: false,
          sort: [{ field: column, direction: "asc" }],
          limit: 100,
          offset: 0,
        },
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (controller.signal.aborted) return;
        const result = data as Result;
        setLoadedContext(context);
        setChoices(
          result.rows
            .map((row) => row[column])
            .filter((value) => value !== null),
        );
        setMessage(
          result.hasMore
            ? "先頭100候補。見つからない値は直接入力できます。"
            : "他の検索条件に合う候補です。",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadedContext(context);
          setMessage(
            "候補を取得できません。直接入力するか、再取得してください。",
          );
        }
      });
    return () => controller.abort();
  }, [requested, context, date, boolean]);
  return (
    <div>
      {boolean ? (
        <select
          aria-label={`条件${index + 1}の値`}
          value={String(filter.value)}
          onChange={(e) => onChange(e.target.value === "true")}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          aria-label={`条件${index + 1}の値`}
          list={date ? undefined : id}
          type={field && isNumeric(field) ? "number" : date ? "date" : "text"}
          value={String(filter.value ?? "")}
          onChange={(event) =>
            onChange(
              field && isNumeric(field)
                ? Number(event.target.value)
                : field?.type === "BOOLEAN"
                  ? event.target.value === "true"
                  : event.target.value,
            )
          }
        />
      )}
      {!date && !boolean && (
        <>
          <datalist id={id}>
            {(loadedContext === context ? choices : []).map((value) => (
              <option key={String(value)} value={String(value)} />
            ))}
          </datalist>
          <button type="button" onClick={() => setRequested((value) => !value)}>
            {requested ? "候補を閉じる" : "候補を取得"}
          </button>
          {requested && (
            <small role="status">
              {loadedContext === context ? message : "候補を取得中…"}
            </small>
          )}
        </>
      )}
    </div>
  );
}
