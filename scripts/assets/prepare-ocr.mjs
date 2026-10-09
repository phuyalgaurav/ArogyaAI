import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// All assets come from exact, integrity-locked npm dependencies. No runtime CDN.
const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const destination = new URL("../../apps/web/public/ocr/", import.meta.url);
await mkdir(new URL("core/", destination), { recursive: true });
await mkdir(new URL("languages/", destination), { recursive: true });
const packageRoot = (name) => dirname(require.resolve(`${name}/package.json`));
const js = packageRoot("tesseract.js");
const core = packageRoot("tesseract.js-core");
await copyFile(
  join(js, "dist/worker.min.js"),
  new URL("worker.min.js", destination),
);
await copyFile(
  join(js, "LICENSE.md"),
  new URL("LICENSE-tesseract.md", destination),
);
await copyFile(join(core, "LICENSE"), new URL("LICENSE-core.txt", destination));
for (const filename of await readdir(core)) {
  if (filename.endsWith(".wasm") || filename.endsWith(".wasm.js")) {
    await copyFile(
      join(core, filename),
      new URL(`core/${filename}`, destination),
    );
  }
}
const languages = {};
for (const code of ["eng", "nep"]) {
  const root = packageRoot(`@tesseract.js-data/${code}`);
  const file = join(root, "4.0.0_best_int", `${code}.traineddata.gz`);
  const data = await readFile(file);
  languages[code] = {
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    package: `@tesseract.js-data/${code}@1.0.0`,
  };
  await copyFile(
    file,
    new URL(`languages/${code}.traineddata.gz`, destination),
  );
  await copyFile(
    join(root, "README.md"),
    new URL(`languages/README-${code}.md`, destination),
  );
  const metadata = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  await writeFile(
    new URL(`languages/NOTICE-${code}.json`, destination),
    `${JSON.stringify(
      {
        name: metadata.name,
        version: metadata.version,
        license: metadata.license,
        author: metadata.author,
        homepage: metadata.homepage,
        repository: metadata.repository,
      },
      null,
      2,
    )}\n`,
  );
}
await writeFile(
  new URL("manifest.json", destination),
  `${JSON.stringify(
    {
      engine: "tesseract.js",
      version: "7.0.0",
      core_version: "7.0.0",
      languages,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  new URL("NOTICE.txt", destination),
  "Tesseract.js 7.0.0 and Tesseract.js-core 7.0.0: Apache-2.0. Language npm packages 1.0.0: MIT.\n" +
    "Sources: github.com/naptha/tesseract.js, github.com/naptha/tesseract.js-core, github.com/naptha/tessdata.\n",
);
console.log("Prepared same-origin English/Nepali browser OCR assets.");
