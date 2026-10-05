import { NextResponse } from "next/server";
import { loadState, mutateState } from "@/lib/provider";
import { readJson, sameOrigin } from "@/lib/http";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await loadState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "保存領域を読み込めません。APP.METADATAとAPP.DATASETSの設定を確認してください。",
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
        kind: z.enum(["dataset", "saved", "favorite", "recent"]),
        payload: z.unknown(),
      })
      .strict()
      .parse(await readJson(req));
    return NextResponse.json(await mutateState(body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "保存できません。入力内容と保存先の権限を確認してください。" },
      { status: 400 },
    );
  }
}
