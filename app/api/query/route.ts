import { NextResponse } from "next/server";
import { runQuery } from "@/lib/provider";
import { exportCsv } from "@/lib/csv";
import { readJson, sameOrigin } from "@/lib/http";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = z
      .object({
        query: z.unknown(),
        datasetId: z.string().max(80).optional(),
        csv: z.boolean().optional(),
      })
      .strict()
      .parse(await readJson(req, 100000));
    const result = await runQuery(body.query, body.datasetId, req.signal);
    if (body.csv)
      return new Response(exportCsv(result), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="snowlens.csv"',
          "Cache-Control": "no-store",
        },
      });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error:
          /Unknown field|Invalid|Required semantic|Choose|Numeric|Sort|Duplicate|null operator|Source|Dataset/.test(
            message,
          )
            ? message
            : "クエリを実行できません。条件・権限を確認して再実行してください。",
      },
      { status: 400 },
    );
  }
}
