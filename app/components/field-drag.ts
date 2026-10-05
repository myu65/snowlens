export const fieldMime = "application/x-snowlens-fields";
export type FieldDrag =
  | { kind: "columns"; ids: string[] }
  | { kind: "dimension" | "metric"; index: number };
export function readFieldDrag(transfer: DataTransfer): FieldDrag | undefined {
  try {
    const raw = transfer.getData(fieldMime);
    if (raw.length > 10000) return;
    const value = JSON.parse(raw);
    if (
      value.kind === "columns" &&
      Array.isArray(value.ids) &&
      value.ids.length > 0 &&
      value.ids.length <= 24 &&
      value.ids.every(
        (id: unknown) => typeof id === "string" && id.length <= 255,
      )
    )
      return { kind: "columns", ids: value.ids };
    if (
      ["dimension", "metric"].includes(value.kind) &&
      Number.isInteger(value.index) &&
      value.index >= 0 &&
      value.index < 12
    )
      return { kind: value.kind, index: value.index };
  } catch {
    /* Foreign drags are ignored. */
  }
}
