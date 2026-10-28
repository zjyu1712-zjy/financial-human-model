import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INPUT,
  calculateCosts,
  calculateDashboard,
  calculateConstraints,
  desireHealth,
  simulate
} from "../src/model.js";

const copy = (value) => JSON.parse(JSON.stringify(value));

test("all modeled costs are non-negative", () => {
  const input = copy(DEFAULT_INPUT);
  const costs = calculateCosts(input.state, input.actions);
  assert.ok(Object.values(costs).every((value) => value >= 0));
});

test("risk overload creates risk cost and crosses a constraint", () => {
  const input = copy(DEFAULT_INPUT);
  input.actions.risk = 100;
  const constraints = calculateConstraints(input.state, input.actions);
  const dashboard = calculateDashboard(input.state, input.actions);
  assert.ok(input.actions.risk > constraints.risk.soft);
  assert.ok(dashboard.costs.risk > 0);
  assert.notEqual(dashboard.levels.risk, "safe");
});

test("desire health falls as comparison pressure rises", () => {
  const lowPressure = { ...DEFAULT_INPUT.state, desirePressure: 10 };
  const highPressure = { ...DEFAULT_INPUT.state, desirePressure: 90 };
  assert.ok(desireHealth(lowPressure) > desireHealth(highPressure));
});

test("simulation remains bounded and returns an initial frame", () => {
  const input = copy(DEFAULT_INPUT);
  const frames = simulate(input.state, input.actions, -8, 12);
  assert.equal(frames.length, 13);
  for (const frame of frames) {
    assert.ok(Object.values(frame.state).every((value) => value >= 0 && value <= 100));
  }
});
