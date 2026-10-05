import { it, expect } from "vitest";
import { readJson, sameOrigin } from "../lib/http";
it("rejects oversized JSON even without Content-Length", async () => {
  const r = new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ x: "a".repeat(500) }),
  });
  await expect(readJson(r, 100)).rejects.toThrow("Request too large");
});
it("accepts bounded JSON and rejects a foreign origin", async () => {
  expect(
    await readJson(
      new Request("http://localhost", { method: "POST", body: '{"x":1}' }),
    ),
  ).toEqual({ x: 1 });
  expect(() =>
    sameOrigin(
      new Request("http://localhost", {
        headers: { host: "localhost", origin: "https://other.example" },
      }),
    ),
  ).toThrow();
});
