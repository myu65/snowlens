import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, sameOrigin } from "@/lib/http";
import { prepareSemanticDraft } from "@/lib/provider";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const part = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\u0000-\u001f]+$/);
    const body = z
      .object({
        query: z.unknown(),
        datasetId: z.string().max(80).optional(),
        target: z.tuple([part, part, part]),
      })
      .strict()
      .parse(await readJson(req, 100000));
    return NextResponse.json(
      await prepareSemanticDraft(
        body.query,
        body.target,
        body.datasetId,
        req.signal,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error: /個人テーブル|公開|セマンティック|結合/.test(message)
          ? message
          : "下書きを作成できません。項目と元データの権限を確認してください。",
      },
      { status: 400 },
    );
  }
}
