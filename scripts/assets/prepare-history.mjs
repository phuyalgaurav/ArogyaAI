import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const root = dirname(dirname(require.resolve("sql.js")));
const destination = new URL("../../apps/web/public/sqlite/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of ["sql-wasm.js", "sql-wasm.wasm"])
  await copyFile(join(root, "dist", file), new URL(file, destination));
await copyFile(
  join(root, "LICENSE"),
  new URL("LICENSE-sql.js.txt", destination),
);
console.log("Prepared same-origin local SQLite assets.");
