import assert from "node:assert/strict";
import test from "node:test";
import { assessDevice } from "../src/features/settings/device-specs.ts";
import { createRequestId, getApiBaseUrl } from "../src/lib/api.ts";

test("low CPU or memory warns independently, even when the other spec is unknown", () => {
  for (const specs of [
    { threads: 4, memoryGb: 16 },
    { threads: 16, memoryGb: 4 },
    { threads: null, memoryGb: 2 },
    { threads: 2, memoryGb: null },
  ]) {
    assert.equal(assessDevice(specs).level, "low");
  }
});
test("missing specs never become a confirmed capable device", () => {
  assert.equal(assessDevice({ threads: 12, memoryGb: null }).level, "unknown");
  assert.equal(
    assessDevice({ threads: null, memoryGb: null }).level,
    "unknown",
  );
  assert.equal(assessDevice({ threads: 8, memoryGb: 8 }).level, "normal");
});
test("phone API defaults to the same origin and request IDs do not require randomUUID", () => {
  const original = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  try {
    assert.equal(getApiBaseUrl(), "");
    const ids = Array.from({ length: 40 }, () => createRequestId());
    assert.equal(new Set(ids).size, 40);
    assert.ok(ids.every((id) => /^[a-f0-9]{32}$/.test(id)));
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
  }
});
