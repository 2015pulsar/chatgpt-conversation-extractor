"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../src/ui-state.js");

const common = {
  buttonWidth: 120,
  horizontalGap: 24,
  viewportWidth: 1440,
  minLeft: 12,
};

test("expanded sidebar geometry places the button directly left of composer", () => {
  assert.deepEqual(ui.computeHorizontalPlacement({ ...common, composerLeft: 429 }), {
    left: 285,
    visible: true,
  });
});

test("collapsed sidebar geometry remains visible and follows composer", () => {
  assert.deepEqual(ui.computeHorizontalPlacement({ ...common, composerLeft: 325 }), {
    left: 181,
    visible: true,
  });
});

test("narrow geometry hides only when the button cannot fit in viewport", () => {
  assert.deepEqual(ui.computeHorizontalPlacement({ ...common, composerLeft: 130 }), {
    left: -14,
    visible: false,
  });
});
