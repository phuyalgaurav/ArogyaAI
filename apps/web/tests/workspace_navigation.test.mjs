import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "http://localhost/dashboard/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const asModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = pathToFileURL(require.resolve("react")).href;
const jsxUrl = pathToFileURL(require.resolve("react/jsx-runtime")).href;
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
const navigation = asModule(
  transpile(
    await readFile(
      new URL("../src/components/layout/navigation.ts", import.meta.url),
      "utf8",
    ),
  ),
);
const stub = asModule(`import React from ${JSON.stringify(reactUrl)};
export const usePathname = () => globalThis.workspaceFixture.pathname;
export const useRouter = () => globalThis.workspaceFixture.router;
export const useRuntime = () => ({data: null});
export const useHistory = () => globalThis.workspaceFixture.history;
export const useConversation = () => globalThis.workspaceFixture.conversation;
export function SessionProvider({children}) {
  React.useEffect(() => { globalThis.workspaceFixture.providerMounts++; }, []);
  return children;
}
export const HistoryProvider = ({children}) => children;
export const ConversationProvider = HistoryProvider;
export const ProfileProvider = HistoryProvider;
export const ModelProvider = HistoryProvider;
export const ProfileControl = () => null;
export const WorkspaceDialog = () => null;
export const WorkspaceSidebar = () => null;
export const KnowledgeView = () => null;
export const PrivacyView = () => null;
export const EnginesView = () => null;
export const WorkspacePageHeader = ({title}) => React.createElement('h1', {id: 'workspace-title', tabIndex: -1}, title);
export const workspaceCopy = {en: {}, ne: {}};
export const copy = {en: {}, ne: {}};
`);
let source = transpile(
  await readFile(
    new URL("../src/components/layout/WorkspaceLayout.tsx", import.meta.url),
    "utf8",
  ),
);
source = source
  .replaceAll('"@/components/layout/navigation"', JSON.stringify(navigation))
  .replace(/"(?:@\/[^"\n]+|next\/navigation)"/g, JSON.stringify(stub));
const { WorkspaceLayout, useWorkspace } = await import(asModule(source));
const { destinationForHash, destinationForMode } = await import(navigation);

async function fixture(work, initial = "/dashboard/") {
  let workspace;
  let sequence = 0;
  const pushes = [];
  const replacements = [];
  const state = {
    pathname: initial,
    providerMounts: 0,
    history: {
      currentId: "original",
      sending: false,
      newChat() {
        state.history = { ...state.history, currentId: `new-${++sequence}` };
      },
      selectChat(id) {
        state.history = { ...state.history, currentId: id };
      },
      readContext: async (id) => ({
        mode: id === "saved-document" ? "document" : "medicine",
      }),
    },
    conversation: { loading: false, snapshots: {} },
    router: {
      push: (path) => pushes.push(path),
      replace: (path) => replacements.push(path),
    },
  };
  globalThis.workspaceFixture = state;
  window.history.replaceState(null, "", initial);
  localStorage.clear();
  function Probe() {
    workspace = useWorkspace();
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  const render = () =>
    act(async () =>
      root.render(
        React.createElement(WorkspaceLayout, null, React.createElement(Probe)),
      ),
    );
  await render();
  try {
    await work({
      state,
      pushes,
      replacements,
      get workspace() {
        return workspace;
      },
      get newChats() {
        return sequence;
      },
      render,
      async route(path) {
        state.pathname = path;
        await render();
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
}

test("page navigation and browser history restore each workflow without remounting providers", async () =>
  fixture(async (f) => {
    await act(async () => f.workspace.open("transcription"));
    const documentId = f.state.history.currentId;
    await f.route(f.pushes.at(-1));
    f.state.conversation.snapshots[documentId] = { mode: "document" };
    assert.equal(f.newChats, 1);
    await act(async () => f.workspace.open("medicines"));
    const medicineId = f.state.history.currentId;
    await f.route(f.pushes.at(-1));
    f.state.conversation.snapshots[medicineId] = { mode: "medicine" };
    assert.notEqual(medicineId, documentId);
    await act(async () => f.workspace.open("history"));
    await f.route(f.pushes.at(-1));
    // Browser Back/Forward changes pathname without invoking an app link.
    await f.route("/transcription/");
    assert.equal(f.state.history.currentId, documentId);
    await f.route("/medicines/");
    assert.equal(f.state.history.currentId, medicineId);
    assert.equal(f.newChats, 2);
    assert.equal(f.state.providerMounts, 1);
    assert.equal(document.querySelector("h1").textContent, "Medicine info");
    await act(async () => f.workspace.open("transcription"));
    // Session state can update before Next commits the new pathname.
    await f.render();
    assert.equal(f.state.history.currentId, documentId);
    await f.route(f.pushes.at(-1));
    assert.equal(f.state.history.currentId, documentId);
    assert.equal(f.newChats, 2);
  }));

test("resuming a saved record opens its mode and exact session; new chat allocates once", async () =>
  fixture(async (f) => {
    await act(async () => f.workspace.resume("saved-document"));
    assert.equal(f.pushes.at(-1), "/transcription/");
    await f.route(f.pushes.at(-1));
    assert.equal(f.state.history.currentId, "saved-document");
    assert.equal(f.newChats, 0);
    await act(async () => f.workspace.startChat());
    await f.route(f.pushes.at(-1));
    assert.equal(f.state.history.currentId, "new-1");
    assert.equal(f.newChats, 1);
    await f.route("/transcription/");
    assert.equal(f.state.history.currentId, "saved-document");
  }, "/history/"));

test("busy navigation preserves the originating session and offers visible recovery", async () =>
  fixture(async (f) => {
    f.state.conversation.loading = true;
    await f.render();
    await act(async () => f.workspace.open("medicines"));
    assert.equal(f.pushes.length, 0);
    assert.equal(f.newChats, 0);
    assert.equal(f.state.history.currentId, "original");
    assert.match(
      document.querySelector('[role="alert"]').textContent,
      /Cancel it or wait/,
    );
    await f.route("/medicines/");
    assert.equal(f.replacements.at(-1), "/transcription/");
    f.state.conversation.loading = false;
    await f.route("/transcription/");
    await act(async () => f.workspace.open("medicines"));
    assert.equal(f.pushes.at(-1), "/medicines/");
    assert.equal(f.newChats, 1);
  }, "/transcription/"));

test("legacy document bookmarks migrate and source or skip fragments are not pages", () => {
  for (const hash of [
    "#documents",
    "#images",
    "#prescriptions",
    "#transcription",
  ])
    assert.equal(destinationForHash(hash), "transcription");
  assert.equal(destinationForHash("#home"), "dashboard");
  assert.equal(destinationForHash("#privacy"), null);
  assert.equal(destinationForHash("#main"), null);
  assert.equal(destinationForMode("medicine"), "medicines");
});

test("the history page prerenders without a browser origin", async () => {
  const { renderToString } = require("react-dom/server");
  const historyStub = asModule(`
    export const useHistory = () => ({conversations: [], localState: 'loading', server: null, serverStatus: 'Off'});
    export const historyOrigin = () => window.location.origin;
  `);
  const historySource = transpile(
    await readFile(
      new URL("../src/features/history/HistoryView.tsx", import.meta.url),
      "utf8",
    ),
  ).replace(/"@\/[^"\n]+"/g, JSON.stringify(historyStub));
  const { HistoryView } = await import(asModule(historySource));
  const browserWindow = globalThis.window;
  delete globalThis.window;
  try {
    const html = renderToString(
      React.createElement(HistoryView, {
        locale: "en",
        onOpen: async () => {},
        onNew: () => {},
      }),
    );
    assert.match(html, /the configured server/);
  } finally {
    globalThis.window = browserWindow;
  }
});
