import { NextResponse } from "next/server";
import { discover, resolveSource, mockMode } from "@/lib/provider";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("source");
    return NextResponse.json(
      id
        ? await resolveSource(id)
        : {
            sources: await discover(),
            mode: mockMode() ? "mock" : "snowflake",
          },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "データ一覧を取得できません。接続・caller grants・権限を確認してください。",
      },
      { status: 403 },
    );
  }
}
