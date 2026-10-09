import assert from "node:assert/strict";
import test from "node:test";
import {
  bboxToPercent,
  clampZoom,
  originalOcrBox,
  validateImageDimensions,
  validateImageFile,
} from "../src/features/documents/lib/image-file.ts";

test("image admission rejects unsupported, empty and oversized inputs", () => {
  for (const type of ["image/svg+xml", "application/pdf", "image/heic", ""]) {
    assert.throws(() => validateImageFile({ type, size: 1000 }));
  }
  for (const size of [0, 8 * 1024 * 1024 + 1]) {
    assert.throws(() => validateImageFile({ type: "image/jpeg", size }));
  }
  validateImageFile({ type: "image/png", size: 8 * 1024 * 1024 });
});

test("decoded dimensions bound image processing rather than trusting file size", () => {
  assert.throws(() => validateImageDimensions(8000, 8000));
  assert.throws(() => validateImageDimensions(0, 100));
  validateImageDimensions(4000, 4000);
});

test("bboxToPercent maps and clamps bounding box coordinates to stage percentages", () => {
  const percent = bboxToPercent(
    { x0: 100, y0: 200, x1: 500, y1: 600 },
    1000,
    1000,
  );
  assert.equal(percent.left, 10);
  assert.equal(percent.top, 20);
  assert.equal(percent.width, 40);
  assert.equal(percent.height, 40);

  // Zero dimension handling
  const zero = bboxToPercent({ x0: 10, y0: 20, x1: 30, y1: 40 }, 0, 0);
  assert.deepEqual(zero, { left: 0, top: 0, width: 0, height: 0 });
});

test("clampZoom keeps zoom levels bounded between min and max bounds", () => {
  assert.equal(clampZoom(1.25), 1.25);
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(5.0), 3.0);
});

test("line geometry returns to original coordinates after scale and quarter rotations", () => {
  const cases = [
    [0, 500, 250, { x0: 50, y0: 25, x1: 150, y1: 75 }],
    [90, 250, 500, { x0: 175, y0: 50, x1: 225, y1: 150 }],
    [180, 500, 250, { x0: 350, y0: 175, x1: 450, y1: 225 }],
    [270, 250, 500, { x0: 25, y0: 350, x1: 75, y1: 450 }],
  ];
  for (const [rotation, width, height, box] of cases) {
    const mapped = originalOcrBox(box, width, height, 1000, 500, rotation);
    for (const [key, value] of Object.entries({
      x0: 100,
      y0: 50,
      x1: 300,
      y1: 150,
    }))
      assert.ok(
        Math.abs(mapped[key] - value) < 1e-6,
        `${rotation} degrees ${key}`,
      );
  }
});
