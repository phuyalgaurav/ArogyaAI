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
export const useHistory = () => globalThis.chatFixture.history;
export const useSession = () => globalThis.chatFixture.session;
export const useConversation = () => globalThis.chatFixture.conversation;
export const useRecorder = () => globalThis.chatFixture.recorder;
export const useModel = () => ({model: 'default'});
export const useAnswerSpeech = () => ({busy: false});
export const useDraft = (_name, initial) => React.useState(initial);
export const fetchQuestions = async () => [{question: 'What is dehydration?'}];
export class ApiError extends Error {}
export const createRequestId = () => 'test-request';
export const turnUserMessageId = async id => 'user-' + id;
export const audioBase64 = async () => '';
export const audioBlob = () => null;
export const ConsentBanner = () => null;
export const StatusBadge = () => null;
export const WorkspaceIcon = () => null;
`);
const source = transpile(
  await readFile(
    new URL("../src/features/chat/ChatView.tsx", import.meta.url),
    "utf8",
  ),
)
  .replaceAll('"@/lib/copy"', JSON.stringify(copyUrl))
  .replace(/"@\/[^"\n]+"/g, JSON.stringify(stub));
const { ChatView } = await import(asModule(source));

async function fixture(work, consent = true) {
  const calls = [];
  let resolveTurn;
  let rejectTurn;
  const state = {
    history: {
      currentId: "test-chat",
      selected: { messages: [] },
      localState: "ready",
      sending: false,
      syncing: false,
      beginSending() {
        this.sending = true;
        return true;
      },
      endSending() {
        this.sending = false;
      },
      async append(_id, message) {
        this.selected.messages.push(message);
      },
      newChat() {},
    },
    session: {
      token: "test-token",
      hasActiveConsent: consent,
      scopedConsents: {},
      initSession: async () => "test-token",
      grantConsent: async () => ({ id: "test-consent" }),
    },
    conversation: {
      snapshots: {},
      turn(...args) {
        calls.push(args);
        return new Promise((resolve, reject) => {
          resolveTurn = resolve;
          rejectTurn = reject;
        });
      },
      async cancel() {
        rejectTurn?.(new Error("Request cancelled"));
      },
    },
    recorder: { clear() {}, recording: false },
  };
  globalThis.chatFixture = state;
  const root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(React.createElement(ChatView, { locale: "en" })),
  );
  const click = async (text) => {
    const element = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent === text ||
        button.getAttribute("aria-label") === text,
    );
    assert.ok(element, `Control ${text} exists`);
    await act(async () => element.click());
  };
  const press = async (options) => {
    const event = new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () =>
      document.querySelector("textarea").dispatchEvent(event),
    );
    return event;
  };
  try {
    await work({
      state,
      calls,
      click,
      press,
      finish: async (status = "ready") => {
        await act(async () =>
          resolveTurn({
            id: "test-turn",
            health: {
              answer: "Test response",
              status,
              evidence: [],
              safety: { rule_ids: [] },
            },
          }),
        );
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
}

test("topics populate an editable draft; Shift+Enter and composing Enter never send", async () =>
  fixture(async (f) => {
    await f.click("What is dehydration?");
    const field = document.querySelector("textarea");
    assert.equal(field.value, "What is dehydration?");
    assert.equal(document.activeElement, field);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.press({ shiftKey: true })).defaultPrevented, false);
    assert.equal(
      (await f.press({ isComposing: true })).defaultPrevented,
      false,
    );
    assert.equal(f.calls.length, 0);
  }));

test("Enter sends once, shows the pending question, and exposes cancellation", async () =>
  fixture(async (f) => {
    await f.click("What is dehydration?");
    await f.press();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][2], "What is dehydration?");
    assert.equal(
      document.querySelector('[role="log"] .message-text').textContent,
      "What is dehydration?",
    );
    await f.press();
    assert.equal(f.calls.length, 1);
    await f.click("Stop generating");
    assert.equal(f.state.history.sending, false);
    assert.equal(
      document.querySelector("textarea").value,
      "What is dehydration?",
    );
    assert.match(
      document.querySelector(".chat-request-notice").textContent,
      /Stopped/,
    );
    assert.equal(f.state.history.selected.messages.length, 0);
  }));

test("consent is required and an unavailable provider preserves the question for retry", async () => {
  await fixture(async (f) => {
    await f.click("What is dehydration?");
    await f.press();
    assert.equal(f.calls.length, 0);
    assert.equal(
      document.querySelector("textarea").value,
      "What is dehydration?",
    );
    assert.ok(document.querySelector('[role="alert"]'));
  }, false);
  await fixture(async (f) => {
    await f.click("What is dehydration?");
    await f.click("Send message");
    await f.finish("unavailable");
    assert.equal(
      document.querySelector("textarea").value,
      "What is dehydration?",
    );
    assert.equal(f.state.history.selected.messages.length, 2);
    assert.equal(document.querySelectorAll('[role="log"] article').length, 2);
  });
});
