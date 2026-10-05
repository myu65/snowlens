"use client";
import { useState } from "react";
import type { QueryableSource } from "@/lib/model";

export default function JoinDiagram({
  left,
  right,
  leftKey,
  rightKey,
  onKeys,
  leftRows,
  rightRows,
}: {
  left: QueryableSource;
  right: QueryableSource;
  leftKey: string;
  rightKey: string;
  onKeys: (left: string, right: string) => void;
  leftRows?: number;
  rightRows?: number;
}) {
  const [offsets, setOffsets] = useState([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
  const sources = [left, right],
    keys = [leftKey, rightKey],
    rows = [leftRows, rightRows];
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
        {left.fields.find((f) => f.id === leftKey)?.label} ={" "}
        {right.fields.find((f) => f.id === rightKey)?.label}
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
            <strong>{source.name}</strong>
            <small>
              {source.database}.{source.schema}
              {rows[i] !== undefined ? ` · ${rows[i]!.toLocaleString()}行` : ""}
            </small>
          </div>
          <div className="node-fields">
            {source.fields.map((field) => (
              <button
                key={field.id}
                className={field.id === keys[i] ? "selected" : ""}
                aria-pressed={field.id === keys[i]}
                aria-label={`${i === 0 ? "元データ" : "結合先"}のキー ${field.label}`}
                onClick={() =>
                  onKeys(
                    i === 0 ? field.id : leftKey,
                    i === 1 ? field.id : rightKey,
                  )
                }
              >
                <span className="node-port" /> <span>{field.label}</span>
                <small>{field.type}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
