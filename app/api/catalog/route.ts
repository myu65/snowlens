import { NextResponse } from "next/server";
import {
  discover,
  resolveSource,
  mockMode,
  browseCatalog,
  resolveMetricSource,
} from "@/lib/provider";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("source");
    if (params.get("browse") === "1") {
      const input = Object.fromEntries(
        ["database", "schema", "kind", "after"]
          .filter((k) => params.has(k))
          .map((k) => [k, params.get(k)]),
      );
      return NextResponse.json(await browseCatalog(input), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(
      id
        ? params.has("metric")
          ? await resolveMetricSource(id, params.get("metric")!)
          : await resolveSource(id)
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
