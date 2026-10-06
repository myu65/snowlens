import { unlink } from "node:fs/promises";
export default async function teardown() {
  await unlink(".snowlens-e2e.json").catch(() => {});
  await unlink(".snowlens-e2e.json.ledgers.json").catch(() => {});
}
