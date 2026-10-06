import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import snowflake from "snowflake-sdk";
import { callerToken } from "./metadata";

export const mockMode = () => process.env.SNOWLENS_MODE !== "snowflake";
export type SnowflakeRows = Record<string, unknown>[];
export type SnowflakeExecute = (
  sql: string,
  binds?: (string | number | boolean)[],
) => Promise<SnowflakeRows>;
// One connection per HTTP request. No global session/role pooling across users.
export async function withSnowflake<T>(
  fn: (execute: SnowflakeExecute) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const h = await headers();
  const caller = h.get("Sf-Context-Current-User-Token");
  const service = await readFile("/snowflake/session/token", "utf8").catch(
    () => null,
  );
  if (!service || !caller)
    throw Error(
      "Caller credentials unavailable. Snowflake mode requires trusted App Runtime ingress.",
    );
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    host: process.env.SNOWFLAKE_HOST,
    authenticator: "OAUTH",
    token: callerToken(service, caller),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  });
  await new Promise<void>((resolve, reject) =>
    connection.connect((err) => (err ? reject(err) : resolve())),
  );
  try {
    const execute: SnowflakeExecute = (sql, binds = []) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(Error("Query cancelled"));
          return;
        }
        const stmt = connection.execute({
          sqlText: sql,
          binds,
          complete: (err, _stmt, rows) => {
            signal?.removeEventListener("abort", cancel);
            if (err) reject(err);
            else resolve(rows || []);
          },
        });
        const cancel = () => {
          stmt.cancel(() => {});
          reject(Error("Query cancelled"));
        };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    await execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 60");
    return await fn(execute);
  } finally {
    await new Promise<void>((resolve) => connection.destroy(() => resolve()));
  }
}
