"use client";
import { useState } from "react";
import type { QueryableSource, RelationKeyPair } from "@/lib/model";

export default function JoinDiagram({
  left,
  right,
  keys,
  activeKey,
  onActiveKey,
  onKeys,
  leftRows,
  rightRows,
}: {
  left: QueryableSource;
  right: QueryableSource;
  keys: RelationKeyPair[];
  activeKey: number;
  onActiveKey: (index: number) => void;
  onKeys: (left: string, right: string) => void;
  leftRows?: number;
  rightRows?: number;
}) {
  const [offsets, setOffsets] = useState([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
  const sources = [left, right],
    rows = [leftRows, rightRows];
  const active = keys[activeKey] || keys[0];
  return (
    <div className="join-canvas" aria-label="結合ノード">
      <svg
        className="node-edge"
        viewBox="0 0 800 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={`M ${295 + offsets[0].x} ${150 + offsets[0].y} C 410 150, 390 150, ${505 + offsets[1].x} ${150 + offsets[1].y}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx={295 + offsets[0].x}
          cy={150 + offsets[0].y}
          r="5"
          fill="currentColor"
        />
        <circle
          cx={505 + offsets[1].x}
          cy={150 + offsets[1].y}
          r="5"
          fill="currentColor"
        />
      </svg>
      <span className="node-condition">
        {keys.map((key, i) => (
          <span key={i}>
            {i > 0 && <small>かつ</small>}
            {i + 1}.{" "}
            {left.fields.find((f) => f.id === key.sourceField)?.label ||
              "未選択"}{" "}
            ={" "}
            {right.fields.find((f) => f.id === key.rightField)?.label ||
              "未選択"}
          </span>
        ))}
      </span>
      {sources.map((source, i) => (
        <div
          key={i}
          className={`join-node node-${i}`}
          style={{
            transform: `translate(${offsets[i].x}px,${offsets[i].y}px)`,
          }}
        >
          <div
            className="node-heading"
            onPointerDown={(e) => {
              const startX = e.clientX,
                startY = e.clientY,
                initial = offsets[i];
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);
              const move = (event: PointerEvent) =>
                setOffsets((old) =>
                  old.map((value, j) =>
                    j === i
                      ? {
                          x: Math.max(
                            -24,
                            Math.min(24, initial.x + event.clientX - startX),
                          ),
                          y: Math.max(
                            -12,
                            Math.min(12, initial.y + event.clientY - startY),
                          ),
                        }
                      : value,
                  ),
                );
              const finish = () => {
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", finish);
                target.removeEventListener("pointercancel", finish);
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", finish);
              target.addEventListener("pointercancel", finish);
            }}
          >
            <strong>{source.label || source.name}</strong>
            <small>
              {source.database}.{source.schema}
              {rows[i] !== undefined ? ` · ${rows[i]!.toLocaleString()}行` : ""}
            </small>
          </div>
          <div className="node-fields">
            {source.fields.map((field) => {
              const selected = keys.findIndex(
                (key) =>
                  field.id === (i === 0 ? key.sourceField : key.rightField),
              );
              return (
                <button
                  key={field.id}
                  className={selected >= 0 ? "selected" : ""}
                  aria-pressed={selected >= 0}
                  aria-label={`${i === 0 ? "元データ" : "結合先"}のキー ${field.label}`}
                  onClick={() =>
                    selected >= 0
                      ? onActiveKey(selected)
                      : onKeys(
                          i === 0 ? field.id : active.sourceField,
                          i === 1 ? field.id : active.rightField,
                        )
                  }
                >
                  <span className="node-port" /> <span>{field.label}</span>
                  {selected >= 0 && (
                    <small className="node-key-number">{selected + 1}</small>
                  )}
                  <small>{field.type}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
