import { writeFile, unlink } from "node:fs/promises";
import { defaultDatasets } from "../lib/mock";
export default async function setup() {
  await unlink(".snowlens-e2e.json.ledgers.json").catch(() => {});
  await writeFile(
    ".snowlens-e2e.json",
    JSON.stringify({
      datasets: defaultDatasets(),
      saved: [],
      favorites: [],
      recent: [],
    }),
  );
}
