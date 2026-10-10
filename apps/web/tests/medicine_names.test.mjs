import assert from "node:assert/strict";
import test from "node:test";
import { medicineNames } from "../src/features/documents/lib/medicine-names.ts";

test("extracts deduplicated medicine names without dose or patient details", () => {
  assert.deepEqual(
    medicineNames(
      "Patient: Demo\n1. Tab. Paracetamol 500 mg BD\nCap Amoxicillin 250 mg\nParacetamol 500 mg\nGlucose: 100 mg/dL\nFollow-up Monday",
    ),
    ["Paracetamol", "Amoxicillin"],
  );
});
test("supports model-selected medicine lines and excludes illegible names", () => {
  assert.deepEqual(
    medicineNames("Cetirizine\n[illegible] 10 mg", ["Cetirizine"]),
    ["Cetirizine"],
  );
});
