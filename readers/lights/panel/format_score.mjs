/* Run the hub formatter (server/handler.js) on a raw .score file, writing the
   protocol view the arranger consumes. Used by the panel's /api/import.
     node format_score.mjs <scores-dir> <name> <out.json> */
import { writeFile } from "node:fs/promises";
import { createFileStore } from "../../../server/store/file.js";
import { createHandler } from "../../../server/handler.js";

const [dir, name, outfile] = process.argv.slice(2);
const handler = createHandler({ store: createFileStore(dir) });
const result = await handler.handle({ score: name });
await writeFile(outfile, JSON.stringify(result));
console.log(`formatted ${name} -> ${outfile}`);
