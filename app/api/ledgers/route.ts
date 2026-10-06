import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, readJson } from "@/lib/http";
import { mockMode } from "@/lib/snowflake-session";
import { demoLedgerRoles } from "@/lib/ledger-mock";
import { ledgerIdSchema, ledgerSpaceIdSchema } from "@/lib/ledger-model";
import {
  createLedger,
  getLedger,
  getLedgerRecord,
  ledgerPublicError,
  listLedgerRecords,
  listLedgerSpaces,
  listLedgers,
  saveLedgerLayout,
  saveLedgerRecord,
} from "@/lib/ledger-provider";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const failure = (error: unknown) => {
  const result = ledgerPublicError(error);
  return reply({ error: result.error }, result.status);
};
const target = {
  space: ledgerSpaceIdSchema,
  id: ledgerIdSchema,
};
const action = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), ...target, layout: z.unknown() })
    .strict(),
  z
    .object({
      action: z.literal("layout"),
      ...target,
      version: z.number().int().positive(),
      layout: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("record"),
      ...target,
      layoutVersion: z.number().int().positive(),
      recordId: ledgerIdSchema,
      version: z.number().int().min(0),
      values: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      ...target,
      layoutVersion: z.number().int().positive(),
      recordId: ledgerIdSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ action: z.literal("demo_role"), role: z.string() }).strict(),
]);
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") || "spaces";
    if (kind === "spaces") return reply(await listLedgerSpaces());
    const space = ledgerSpaceIdSchema.parse(params.get("space"));
    if (kind === "list") return reply(await listLedgers(space));
    const id = ledgerIdSchema.parse(params.get("id"));
    if (kind === "detail") return reply(await getLedger(space, id));
    if (kind === "records")
      return reply(
        await listLedgerRecords(
          space,
          id,
          params.get("search") || "",
          Number(params.get("offset") || 0),
        ),
      );
    if (kind === "record")
      return reply(
        await getLedgerRecord(
          space,
          id,
          ledgerIdSchema.parse(params.get("record")),
        ),
      );
    throw Error("invalid");
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = action.parse(await readJson(request, 200000));
    if (body.action === "demo_role") {
      if (!mockMode() || !demoLedgerRoles.some((r) => r.id === body.role))
        return reply(
          { error: "この環境ではデモのロールを切り替えられません。" },
          403,
        );
      const response = reply({ ok: true });
      response.cookies.set("snowlens_ledger_demo_role", body.role, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
      return response;
    }
    if (body.action === "create")
      return reply(await createLedger(body.space, body.id, body.layout), 201);
    if (body.action === "layout")
      return reply(
        await saveLedgerLayout(body.space, body.id, body.version, body.layout),
      );
    return reply(
      await saveLedgerRecord(
        body.space,
        body.id,
        body.layoutVersion,
        body.recordId,
        body.version,
        body.action === "record" ? body.values : {},
        body.action === "delete",
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
