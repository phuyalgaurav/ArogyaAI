import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const dom = new JSDOM("<!doctype html><div id='root'></div>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require("react-dom/client");
const reactUrl = pathToFileURL(require.resolve("react")).href;
const jsxUrl = pathToFileURL(require.resolve("react/jsx-runtime")).href;
const moduleUrl = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const stub = moduleUrl(`
export const useSession = () => ({scopedConsents:{}, grantProcessing:async () => ({token:'test',consent:{id:'speech-consent'}})});
export const audioBlob = () => new Blob(['audio']);
export const getApiBaseUrl = () => '';
export const splitSpeech = text => [text];
`);
const source = ts
  .transpileModule(
    await readFile(
      new URL("../src/features/documents/DocumentSpeech.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxUrl))
  .replaceAll('"react"', JSON.stringify(reactUrl))
  .replace(/"@\/[^"\n]+"/g, JSON.stringify(stub));
const { DocumentSpeech } = await import(moduleUrl(source));
test("English guide plays Nepali text, advances chunks, and stops audio", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({
        audio_base64: "AA==",
        text: JSON.parse(options.body).text,
      }),
    };
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        React.createElement(DocumentSpeech, {
          ne: false,
          result: {
            speech_text_ne: "यो कागजातको मस्यौदा हो।",
            items: [
              {
                meaning: "Medicine wording.",
                speech_text_ne: "औषधिको नाम पुष्टि गर्नुहोस्।",
              },
            ],
          },
        }),
      ),
    );
    await act(async () => document.querySelector("button").click());
    assert.equal(calls[0].url, "/api/v1/speech/synthesize");
    assert.equal(calls[0].body.language, "ne");
    assert.equal(calls[0].body.consent_id, "speech-consent");
    assert.ok(document.querySelector("audio"));
    await act(async () =>
      document
        .querySelector("audio")
        .dispatchEvent(new dom.window.Event("ended")),
    );
    assert.equal(calls[1].body.text, "औषधिको नाम पुष्टि गर्नुहोस्।");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Stop audio")
        .click(),
    );
    assert.equal(document.querySelector("audio"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
