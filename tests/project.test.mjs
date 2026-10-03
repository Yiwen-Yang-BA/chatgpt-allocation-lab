import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const near = (actual, expected, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≈ ${expected}`,
  );
const defaults = {
  csv: "date,A,B\n2026-01-01,.1,0\n2026-01-02,0,.1\n2026-01-03,-.1,0",
  weights: [0.5, 0.5],
  periodsPerYear: 3,
  annualRiskFree: 0,
  gridStep: 0.1,
};
const demo = { generate: async (spec) => spec.demo() };
const byKey = (result, key) =>
  result.portfolios.find((item) => item.key === key);

test("case B uses sample covariance, arithmetic means and distinct compounded returns", async () => {
  const result = await run(defaults, demo);
  near(result.covariance[0][0], 0.03);
  near(result.covariance[1][1], 0.01);
  near(result.covariance[0][1], 0);
  assert.equal(result.covariance[0][1], result.covariance[1][0]);
  near(result.annualMeans[0], 0);
  near(result.annualMeans[1], 0.1);
  const equal = byKey(result, "equal");
  near(equal.annualMean, 0.05);
  near(equal.annualVolatility, 0.1);
  near(equal.sharpe, 0.5);
  near(equal.totalReturn, 0.047375);
  near(equal.annualReturn, 0.047375);
  assert.equal(equal.equity.length, 4);
});

test("finite 10% grid chooses a discrete minimum and resolves ties in fixed order", async () => {
  const result = await run(defaults, demo);
  assert.equal(result.grid.candidateCount, 11);
  const minimum = byKey(result, "min-vol");
  assert.deepEqual(minimum.weights, [0.2, 0.8]);
  near(minimum.annualVolatility, Math.sqrt(0.0076));
  assert.notEqual(minimum.weights[0], 0.25);
  assert.ok(minimum.annualVolatility > Math.sqrt(0.0075));
  const repeated = await run(defaults, demo);
  assert.deepEqual(byKey(repeated, "min-vol").weights, minimum.weights);
});

test("four-asset 5% integer grid contains exactly 1771 valid unique allocations", async () => {
  const result = await run(
    {
      ...defaults,
      csv: "date,A,B,C,D\n2026-01-01,0,.01,.02,.03\n2026-01-02,.03,.02,.01,0",
      weights: [0.25, 0.25, 0.25, 0.25],
      gridStep: 0.05,
    },
    demo,
  );
  assert.equal(result.grid.candidateCount, 1771);
  assert.equal(
    new Set(result.grid.candidates.map((item) => JSON.stringify(item.weights)))
      .size,
    1771,
  );
  for (const item of result.grid.candidates) {
    near(
      item.weights.reduce((sum, value) => sum + value, 0),
      1,
    );
    assert.ok(item.weights.every((value) => value >= 0 && value <= 1));
  }
});

test("identical assets produce a valid singular covariance and equal portfolio risks", async () => {
  const result = await run(
    {
      ...defaults,
      csv: "date,A,B\n2026-01-01,.1,.1\n2026-01-02,0,0\n2026-01-03,-.1,-.1",
    },
    demo,
  );
  near(result.covariance[0][0], result.covariance[0][1]);
  near(result.covariance[1][1], result.covariance[0][1]);
  for (const item of result.grid.candidates)
    near(item.annualVolatility, Math.sqrt(0.03));
});

test("constant portfolios have zero volatility and omit the undefined maximum Sharpe", async () => {
  const result = await run(
    {
      ...defaults,
      csv: "date,A,B\n2026-01-01,.1,.2\n2026-01-02,.1,.2\n2026-01-03,.1,.2",
    },
    demo,
  );
  assert.ok(
    result.grid.candidates.every(
      (item) => item.annualVolatility === 0 && item.sharpe === null,
    ),
  );
  assert.equal(byKey(result, "max-sharpe"), undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("未展示最高")));
});

test("perfectly opposing returns preserve a true zero-risk allocation", async () => {
  const result = await run(
    {
      ...defaults,
      csv: "date,A,B\n2026-01-01,.1,-.1\n2026-01-02,-.1,.1\n2026-01-03,0,0",
    },
    demo,
  );
  const equal = byKey(result, "equal");
  assert.equal(equal.annualVolatility, 0);
  assert.equal(equal.sharpe, null);
  assert.deepEqual(equal.equity, [1, 1, 1, 1]);
  assert.deepEqual(byKey(result, "min-vol").weights, [0.5, 0.5]);
  const shifted = await run(
    {
      ...defaults,
      csv: "date,A,B\n2026-01-01,-.1,.12\n2026-01-02,0,.02\n2026-01-03,.1,-.08",
    },
    demo,
  );
  const stable = byKey(shifted, "equal");
  near(stable.annualMean, 0.03);
  assert.equal(stable.annualVolatility, 0);
  assert.equal(stable.sharpe, null);
  assert.ok(
    shifted.warnings.some((warning) => warning.includes("机器舍入误差")),
  );
});

test("annual-input mean-variance Sharpe uses the specified risk-free convention", async () => {
  const result = await run({ ...defaults, annualRiskFree: 0.02 }, demo);
  near(byKey(result, "equal").sharpe, 0.3);
  assert.match(result.warnings.join(" "), /收益序列 Sharpe 口径不同/);
});

test("weights, date ordering, missing data and return bounds are enforced", async () => {
  for (const invalid of [
    { weights: [1] },
    { weights: [-0.1, 1.1] },
    { weights: [0.5, 0.49] },
    { weights: [NaN, 0.5] },
    { gridStep: 0.2 },
    { periodsPerYear: 0 },
    { annualRiskFree: -1 },
    { csv: "date,A,B\n2026-01-01,0,0" },
    { csv: defaults.csv.replace("2026-01-02", "2026-01-01") },
    { csv: defaults.csv.replace("2026-01-02", "2026-02-30") },
    { csv: defaults.csv.replace(",0,.1", ",,.1") },
    { csv: defaults.csv.replace(",.1,0", ",10.1,0") },
    { csv: defaults.csv.replace(",-.1,0", ",-1.1,0") },
  ])
    await assert.rejects(
      run({ ...defaults, ...invalid }, demo),
      ValidationError,
    );
  const normalized = await run(
    { ...defaults, weights: [0.5, 0.5000000001] },
    demo,
  );
  near(
    byKey(normalized, "manual").weights.reduce((sum, value) => sum + value, 0),
    1,
  );
});

test("AI receives selected weights and metrics without matrices, raw returns or paths", async () => {
  let observed;
  const result = await run(
    { ...defaults, csv: defaults.csv.replace(",A,B", ",__proto__,中文资产") },
    {
      generate: async (spec) => {
        observed = spec;
        return { text: "仅解释已计算的汇总。" };
      },
    },
  );
  const input = JSON.parse(observed.input);
  assert.deepEqual(Object.keys(input), ["settings", "assets", "portfolios"]);
  assert.deepEqual(result.assets, ["__proto__", "中文资产"]);
  assert.equal(input.covariance, undefined);
  assert.equal(input.grid, undefined);
  assert.equal(input.portfolios[0].equity, undefined);
  assert.equal(input.portfolios[0].drawdown, undefined);
  assert.match(observed.instructions, /not continuous global optima/);
});

test("wipeout stays at zero and unrepresentable covariance or annualization is rejected", async () => {
  const loss = await run(
    { ...defaults, csv: "date,A,B\n2026-01-01,-1,-1\n2026-01-02,.5,.5" },
    demo,
  );
  assert.deepEqual(byKey(loss, "equal").equity, [1, 0, 0]);
  await assert.rejects(
    run(
      {
        ...defaults,
        csv: "date,A,B\n2026-01-01,1e-200,0\n2026-01-02,2e-200,.1",
      },
      demo,
    ),
    /精度/,
  );
  await assert.rejects(
    run(
      {
        ...defaults,
        periodsPerYear: 365,
        csv: "date,A,B\n2026-01-01,10,10\n2026-01-02,10,10",
      },
      demo,
    ),
    ValidationError,
  );
});
