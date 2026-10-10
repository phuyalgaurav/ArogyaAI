import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

test("history worker and SQLite helper bypass older cached protocols together", () => {
  const version = "release-content-hash";
  let workerUrl;
  const client = readFileSync(
    new URL("../src/features/history/local-history.ts", import.meta.url),
    "utf8",
  );
  const scope = {
    process: { env: { NEXT_PUBLIC_HISTORY_VERSION: version } },
    Worker: class {
      constructor(url) {
        workerUrl = url;
      }
    },
  };
  vm.runInNewContext(
    `${stripTypeScriptTypes(client).replace("export class", "class")}\nnew LocalHistory();`,
    scope,
  );
  assert.equal(workerUrl, `/history-worker.js?v=${version}`);
  let imported;
  vm.runInNewContext(
    readFileSync(
      new URL("../public/history-worker.js", import.meta.url),
      "utf8",
    ),
    {
      self: { location: new URL(workerUrl, "https://example.test") },
      importScripts: (...urls) => {
        imported = urls;
      },
      initSqlJs: () => Promise.resolve({}),
    },
  );
  assert.equal(imported[1], `/history-sqlite.js?v=${version}`);
});
