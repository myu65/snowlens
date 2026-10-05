import { NextResponse } from "next/server";
import { z } from "zod";
import { runFactDetail } from "@/lib/provider";
import { readJson, sameOrigin } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = z
      .object({ query: z.unknown(), datasetId: z.string().min(1).max(80) })
      .strict()
      .parse(await readJson(req, 100000));
    return NextResponse.json(
      await runFactDetail(body.query, body.datasetId, req.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error: /Invalid unmapped detail condition/.test(message)
          ? "明細への対応づけがない条件があります。Dataset Ownerに確認してください。"
          : "明細を取得できません。条件の対応づけ・項目の型・明細元の権限を確認してください。",
      },
      { status: 400 },
    );
  }
}
