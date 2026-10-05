import { writeFile } from "node:fs/promises";
import { defaultDatasets } from "../lib/mock";
export default async function setup() {
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
