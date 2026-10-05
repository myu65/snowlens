import { NextResponse } from "next/server";
import { z } from "zod";
import { loadPersonalTable } from "@/lib/provider";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const id = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .parse(new URL(req.url).searchParams.get("id"));
    const table = await loadPersonalTable(id);
    if (!table) throw Error("Unavailable");
    return NextResponse.json(table, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "個人テーブルにアクセスできません。" },
      { status: 403 },
    );
  }
}
