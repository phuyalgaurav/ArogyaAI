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
const asModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) =>
  ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxUrl))
    .replaceAll('"react"', JSON.stringify(reactUrl));
const copyUrl = asModule(
  transpile(
    await readFile(new URL("../src/lib/copy.ts", import.meta.url), "utf8"),
  ),
);
const stub = asModule(`import React from ${JSON.stringify(reactUrl)};
export const useSession = () => globalThis.medicineFixture.session;
export const useHistory = () => ({currentId: 'test-chat'});
export const useConversation = () => globalThis.medicineFixture.conversation;
export const useAnswerSpeech = () => ({busy: false});
export const useDraft = (_name, initial) => [...React.useState(initial), true];
export const useLocalOcr = () => ({progress: 0});
export const useModel = () => ({model: 'bonsai'});
export const useRecorder = () => ({});
export const StatusBadge = () => null;
export const stableTextEntries = () => [];
export const prepareImage = async () => ({});
export const validateImageFile = () => {};
export const createRequestId = () => 'test';
export const resolveMedicine = async () => ({candidates: []});
export const audioBase64 = async () => '';
export const turnUserMessageId = async id => id;
`);
const source = transpile(
  await readFile(
    new URL("../src/features/medicines/MedicineView.tsx", import.meta.url),
    "utf8",
  ),
)
  .replaceAll('"@/lib/copy"', JSON.stringify(copyUrl))
  .replace(/"@\/[^"\n]+"/g, JSON.stringify(stub));
const { MedicineView } = await import(asModule(source));

test("medicine upload uses printed OCR after consent and keeps visual reading optional", async () => {
  const calls = [];
  globalThis.medicineFixture = {
    session: {
      token: "token",
      grantProcessing: async (purpose) => {
        calls.push(purpose);
        return { consent: { id: "consent" } };
      },
    },
    conversation: {
      snapshots: {},
      recognize: async (...args) => {
        calls.push(args);
        return {
          active_attachment_id: "label",
          attachments: [{ id: "label", original_text: "Examplemed 2.5 mg" }],
        };
      },
    },
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        React.createElement(MedicineView, {
          locale: "en",
          processingLocation: "server",
        }),
      ),
    );
    assert.ok(
      document.querySelector("#medicine-label-review"),
      "manual entry available before extraction",
    );
    const file = new File(["synthetic image"], "label.png", {
      type: "image/png",
    });
    const input = document.querySelector("input[type=file]");
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () =>
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true })),
    );
    assert.deepEqual(
      calls,
      [],
      "selecting a photo does not upload before consent",
    );
    const read = () =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Allow and read label",
      );
    await act(async () => read().click());
    assert.equal(calls[0], "image_transcription");
    assert.equal(calls[1][2].method, "printed_ocr");
    assert.equal(calls[1][2].kind, "medicine");
    assert.equal(
      document.querySelector("#medicine-label-review").value,
      "Examplemed 2.5 mg",
    );
    assert.equal(document.querySelector("input[type=checkbox]").checked, false);
    const select = document.querySelector("select");
    await act(async () => {
      select.value = "vision";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => read().click());
    assert.equal(calls[3][2].method, "vision");
  } finally {
    await act(async () => root.unmount());
  }
});
