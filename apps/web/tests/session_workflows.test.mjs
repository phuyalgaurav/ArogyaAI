import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "http://localhost",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const asModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const api =
  asModule(`export const createSession = (...args) => globalThis.sessionFixture.createSession(...args);
export const createConsent = (...args) => globalThis.sessionFixture.createConsent(...args);
export const deleteUserData = (...args) => globalThis.sessionFixture.deleteUserData(...args);
export const revokeConsent = async () => {};`);
let source = await readFile(
  new URL("../src/context/SessionContext.tsx", import.meta.url),
  "utf8",
);
source = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
source = source
  .replaceAll('"@/lib/api"', JSON.stringify(api))
  .replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href),
  )
  .replaceAll(
    '"react"',
    JSON.stringify(pathToFileURL(require.resolve("react")).href),
  );
const { SessionProvider, useSession } = await import(asModule(source));

async function fixture(work) {
  let context;
  let sequence = 0;
  let grantSequence = 0;
  let now = Date.parse("2026-10-10T00:00:00Z");
  let failDelete = false;
  const originalNow = Date.now;
  Date.now = () => now;
  globalThis.sessionFixture = {
    createSession: async () => ({
      access_token: `session-${++sequence}`,
      expires_at: new Date(now + 1000).toISOString(),
    }),
    createConsent: async (token, _ttl, _signal, purpose = "server_chat") => ({
      id: `${token}-grant-${++grantSequence}`,
      purpose,
      expires_at: new Date(now + 10000).toISOString(),
      revoked: false,
    }),
    deleteUserData: async () => {
      if (failDelete) throw new Error("offline");
    },
  };
  function Probe() {
    context = useSession();
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      React.createElement(SessionProvider, null, React.createElement(Probe)),
    ),
  );
  try {
    await work({
      get context() {
        return context;
      },
      advance: () => {
        now += 2000;
      },
      offline: (value) => {
        failDelete = value;
      },
    });
  } finally {
    await act(async () => root.unmount());
    Date.now = originalNow;
  }
}

test("renewing an expired session replaces a still-live scoped grant with the matching identity", async () =>
  fixture(async (f) => {
    let first;
    await act(async () => {
      first = await f.context.grantProcessing("document_explanation");
    });
    assert.equal(first.token, "session-1");
    let reused;
    await act(async () => {
      reused = await f.context.grantProcessing("document_explanation");
    });
    assert.deepEqual(reused, first);
    f.advance();
    let renewed;
    await act(async () => {
      renewed = await f.context.grantProcessing("document_explanation");
    });
    assert.equal(renewed.token, "session-2");
    assert.match(renewed.consent.id, /^session-2-/);
    assert.notEqual(renewed.consent.id, first.consent.id);
  }));

test("failed deletion retains the session for retry and success clears identity and grants", async () =>
  fixture(async (f) => {
    await act(async () => {
      await f.context.grantProcessing("image_transcription");
      await f.context.grantConsent();
    });
    f.offline(true);
    await act(async () => {
      await assert.rejects(f.context.deleteSession(), /not confirmed/);
    });
    assert.equal(f.context.token, "session-1");
    assert.ok(f.context.scopedConsents.image_transcription);
    f.offline(false);
    await act(async () => {
      await f.context.deleteSession();
    });
    assert.equal(f.context.token, null);
    assert.equal(f.context.consent, null);
    assert.deepEqual(f.context.scopedConsents, {});
  }));

let draftSource = await readFile(
  new URL("../src/features/conversations/use-draft.ts", import.meta.url),
  "utf8",
);
draftSource = ts.transpileModule(draftSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
draftSource = draftSource
  .replaceAll(
    '"react"',
    JSON.stringify(pathToFileURL(require.resolve("react")).href),
  )
  .replaceAll(
    '"@/features/history/HistoryContext"',
    JSON.stringify(
      asModule(
        "export const useHistory = () => ({currentId: globalThis.draftSessionId});",
      ),
    ),
  );
const { useDraft } = await import(asModule(draftSource));
test("drafts survive view unmounts and stay isolated by conversation", async () => {
  let draft;
  function Probe() {
    draft = useDraft("text", "");
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  try {
    globalThis.draftSessionId = "first";
    await act(async () =>
      root.render(React.createElement(Probe, { key: "first" })),
    );
    await act(async () => draft[1]("Unsubmitted report"));
    globalThis.draftSessionId = "second";
    await act(async () =>
      root.render(React.createElement(Probe, { key: "second" })),
    );
    assert.equal(draft[0], "");
    await act(async () => draft[1]("Different report"));
    globalThis.draftSessionId = "first";
    await act(async () =>
      root.render(React.createElement(Probe, { key: "first" })),
    );
    assert.equal(draft[0], "Unsubmitted report");
  } finally {
    await act(async () => root.unmount());
  }
});
