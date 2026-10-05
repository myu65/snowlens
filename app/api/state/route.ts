import { NextResponse } from "next/server";
import { loadState, mutateState, stateForBrowser } from "@/lib/provider";
import { readJson, sameOrigin } from "@/lib/http";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(stateForBrowser(await loadState()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "保存領域を読み込めません。個人保存領域と共有Dataset領域の設定を確認してください。",
      },
      { status: 403 },
    );
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = z
      .object({
        kind: z.enum([
          "dataset",
          "saved",
          "favorite",
          "recent",
          "personal",
          "personal_delete",
        ]),
        payload: z.unknown(),
      })
      .strict()
      .parse(await readJson(req));
    return NextResponse.json(stateForBrowser(await mutateState(body)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return NextResponse.json(
      {
        error: /個人テーブル|個人定義|結合|行目|列名/.test(message)
          ? message
          : "保存できません。入力内容と保存先の権限を確認してください。",
      },
      { status: 400 },
    );
  }
}
