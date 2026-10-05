import { NextResponse } from "next/server";
import { z } from "zod";
import { fieldOverrideSchema } from "@/lib/model";
import { runQueryWithContext } from "@/lib/provider";
import { exportExcel } from "@/lib/excel";
import { exportDataCsv } from "@/lib/csv";
import { exportFilename } from "@/lib/export-model";
import { readJson, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = z
      .object({
        query: z.unknown(),
        datasetId: z.string().max(80).optional(),
        fieldOverrides: z.array(fieldOverrideSchema).max(500).default([]),
        format: z.enum(["xlsx", "csv"]),
        headers: z.enum(["labels", "ids"]).default("labels"),
        includeSubtotals: z.boolean().default(false),
      })
      .strict()
      .parse(await readJson(req, 1000000));
    const context = await runQueryWithContext(
      body.query,
      body.datasetId,
      req.signal,
      body.fieldOverrides,
    );
    const content =
      body.format === "xlsx"
        ? await exportExcel(context)
        : exportDataCsv(context, body.headers, body.includeSubtotals);
    return new Response(
      typeof content === "string" ? content : new Uint8Array(content),
      {
        headers: {
          "Content-Type":
            body.format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="snowlens.${body.format}"; filename*=UTF-8''${encodeURIComponent(exportFilename(context, body.format))}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error:
          /Excel|個人定義|個人テーブル|結合|小計|Unknown field|Invalid|Required semantic|Choose|Numeric|Sort|Duplicate|null operator|Source|Dataset/.test(
            message,
          )
            ? message
            : "ダウンロードできません。条件・権限を確認して再実行してください。",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
