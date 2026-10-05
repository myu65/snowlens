import { NextResponse } from "next/server";
import { z } from "zod";
import { previewPersonalJoin } from "@/lib/provider";
import { sameOrigin, readJson } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = z
      .object({ query: z.unknown(), datasetId: z.string().max(80).optional() })
      .strict()
      .parse(await readJson(req, 100000));
    return NextResponse.json(
      await previewPersonalJoin(body.query, body.datasetId, req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error: /個人テーブル|結合|行目/.test(message)
          ? message
          : "結合を確認できません。項目・権限・検索条件を確認してください。",
      },
      { status: 400 },
    );
  }
}
