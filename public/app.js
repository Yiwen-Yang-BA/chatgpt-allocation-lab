import {
  $,
  escape,
  toast,
  download,
  csv,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
import { num, pct, bars, lines } from "./charts.js";
import { reportHTML } from "./reports.js";
let result = null,
  pending = false;
const colors = ["#387f78", "#b57950", "#657baf", "#9b748b"];
function lock(on) {
  pending = on;
  document
    .querySelectorAll(
      "#sample,#csv,#file,#weights,#frequency,#risk-free,#step,#analyze,#mode",
    )
    .forEach((el) => (el.disabled = on));
}
function sample() {
  const a = [
      0.035, -0.025, 0.018, 0.05, -0.04, 0.03, 0.012, -0.01, 0.045, 0.023,
      -0.018, 0.029,
    ],
    b = [
      0.006, 0.008, 0.004, 0.003, 0.009, 0.005, 0.004, 0.007, 0.003, 0.005,
      0.006, 0.004,
    ],
    c = [
      -0.01, 0.025, 0.015, -0.02, 0.035, -0.008, 0.03, 0.015, -0.012, 0.01,
      0.025, -0.005,
    ];
  $("#csv").value =
    "date,Growth,Income,Diversifier\n" +
    a
      .map(
        (v, i) =>
          `2025-${String(i + 1).padStart(2, "0")}-${[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]},${v},${b[i]},${c[i]}`,
      )
      .join("\n");
  $("#weights").value = "0.4,0.35,0.25";
  $("#frequency").value = "12";
  $("#risk-free").value = "2";
  $("#step").value = "0.1";
}
function table(headers, rows) {
  return (
    '<table class="data-table"><thead><tr>' +
    headers.map((h) => "<th>" + escape(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          row.map((c) => "<td>" + escape(c) + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}
function scatter() {
  const points = result.grid.candidates,
    all = [...points, ...result.portfolios];
  let maxX = Math.max(...all.map((p) => p.annualVolatility), 0.001) * 1.1,
    minY = Math.min(0, ...all.map((p) => p.annualMean)),
    maxY = Math.max(0, ...all.map((p) => p.annualMean));
  if (maxY === minY) maxY = 0.01;
  const pad = (maxY - minY) * 0.1;
  minY -= pad;
  maxY += pad;
  const w = 760,
    h = 380,
    left = 75,
    top = 20,
    bottom = 60,
    right = 25,
    x = (v) => left + (v / maxX) * (w - left - right),
    y = (v) => h - bottom - ((v - minY) / (maxY - minY)) * (h - top - bottom);
  return `<svg class="data-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="有限网格风险收益散点"><title>横轴年化波动，纵轴算术年化均值</title>${Array.from(
    { length: 5 },
    (_, i) => {
      const a = (maxX * i) / 4,
        b = minY + ((maxY - minY) * i) / 4;
      return `<line x1="${left}" x2="${w - right}" y1="${y(b)}" y2="${y(b)}" stroke="#e3eae6"/><text x="${left - 10}" y="${y(b) + 4}" text-anchor="end" font-size="11" fill="#6b7d79">${pct(b)}</text><text x="${x(a)}" y="${h - bottom + 20}" text-anchor="middle" font-size="11" fill="#6b7d79">${pct(a)}</text>`;
    },
  ).join(
    "",
  )}${points.map((p) => `<circle cx="${x(p.annualVolatility)}" cy="${y(p.annualMean)}" r="3" fill="#9ebcb5" opacity=".6"/>`).join("")}${result.portfolios.map((p, i) => `<circle cx="${x(p.annualVolatility)}" cy="${y(p.annualMean)}" r="7" fill="${colors[i]}" stroke="white" stroke-width="2"><title>${escape(p.label)} · 波动${pct(p.annualVolatility)} · 均值${pct(p.annualMean)}</title></circle>`).join("")}<text x="${w / 2}" y="${h - 12}" text-anchor="middle" font-size="12" fill="#6b7d79">年化波动率 →</text></svg><div class="chart-legend">${result.portfolios.map((p, i) => `<span><i style="background:${colors[i]}"></i>${escape(p.label)}</span>`).join("")}</div>`;
}
function choose(index) {
  const p = result.portfolios[index];
  $("#metrics").innerHTML = [
    ["算术年化均值", pct(p.annualMean)],
    ["年化波动", pct(p.annualVolatility)],
    ["均值方差 Sharpe", num(p.sharpe, 3)],
    ["历史复合总收益", pct(p.totalReturn)],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${escape(p.label)}</small></div>`,
    )
    .join("");
  $("#weights-chart").innerHTML = bars(
    result.assets.map((label, i) => ({ label, value: p.weights[i] })),
    { label: p.label + " · 资产权重", valueFormat: pct },
  );
  document
    .querySelectorAll("[data-portfolio]")
    .forEach((b, i) => b.classList.toggle("primary", i === index));
}
function metricRows() {
  return result.portfolios.map((p) => [
    p.label,
    pct(p.annualMean),
    pct(p.annualVolatility),
    num(p.sharpe, 3),
    pct(p.totalReturn),
    pct(p.annualReturn),
    pct(p.maxDrawdown),
  ]);
}
const metricHeaders = [
  "组合",
  "算术年化均值",
  "年化波动",
  "均值方差Sharpe",
  "复合总收益",
  "复合年化收益",
  "最大回撤",
];
function render(r) {
  result = { ...r.data, meta: r.meta };
  $("#grid-label").textContent =
    `${result.grid.candidateCount} 个候选 · ${pct(result.grid.step)} 步长`;
  $("#scatter").innerHTML = scatter();
  $("#portfolio-buttons").innerHTML = result.portfolios
    .map(
      (p, i) =>
        `<button class="small" data-portfolio="${i}">${escape(p.label)}</button>`,
    )
    .join("");
  $("#portfolio-table").innerHTML = table(metricHeaders, metricRows());
  $("#equity-chart").innerHTML = lines(
    result.portfolios.map((p) => ({
      name: p.label,
      values: p.equity,
      labels: ["初始", ...result.dates],
    })),
    { label: "每期固定权重的历史净值", format: (v) => num(v, 3) },
  );
  $("#covariance").innerHTML = table(
    ["年化协方差", ...result.assets],
    result.assets.map((a, i) => [
      a,
      ...result.covariance[i].map((v) => num(v, 6)),
    ]),
  );
  $("#warnings").textContent = result.warnings.join("\n");
  $("#meta").innerHTML = resultMeta(r.meta);
  $("#insight").textContent = result.insight;
  $("#exports").hidden = false;
  choose(0);
}
$("#sample").onclick = sample;
$("#portfolio-buttons").onclick = (e) => {
  const b = e.target.closest("[data-portfolio]");
  if (b && result) choose(Number(b.dataset.portfolio));
};
$("#file").onchange = async (e) => {
  if (pending) return;
  lock(true);
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) throw Error("请选择 CSV 文件");
    const text = await fileText(f, 750000);
    if (text.length > 250000) throw Error("最多 250,000 字符");
    $("#csv").value = text;
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
    lock(false);
  }
};
$("#allocation-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending) return;
  lock(true);
  busy($("#analyze"), true, "枚举并比较候选…");
  try {
    const raw = $("#weights")
      .value.split(",")
      .map((v) => v.trim());
    if (raw.some((v) => !v || !Number.isFinite(Number(v))))
      throw Error("权重必须用英文逗号分隔，每一项为数值");
    render(
      await run({
        csv: $("#csv").value,
        weights: raw.map(Number),
        periodsPerYear: Number($("#frequency").value),
        annualRiskFree: Number($("#risk-free").value) / 100,
        gridStep: Number($("#step").value),
      }),
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy($("#analyze"), false);
    lock(false);
  }
};
$("#export-json").onclick = () =>
  result &&
  download(
    "allocation-analysis.json",
    JSON.stringify(result, null, 2),
    "application/json",
  );
$("#export-csv").onclick = () =>
  result &&
  download(
    "allocation-weights.csv",
    csv([
      [
        "portfolio",
        ...result.assets,
        "annualArithmeticMean",
        "annualVolatility",
        "meanVarianceSharpe",
        "compoundedTotalReturn",
      ],
      ...result.portfolios.map((p) => [
        p.label,
        ...p.weights,
        p.annualMean,
        p.annualVolatility,
        p.sharpe,
        p.totalReturn,
      ]),
    ]),
    "text/csv;charset=utf-8",
  );
$("#export-html").onclick = () => {
  if (!result) return;
  download(
    "allocation-report.html",
    reportHTML({
      title: "组合配比历史比较",
      subtitle: "Allocation Lab · 有限权重网格",
      metrics: [
        { label: "资产数", value: result.assets.length },
        { label: "观察期数", value: result.dates.length },
        { label: "候选数", value: result.grid.candidateCount },
        { label: "网格步长", value: pct(result.grid.step) },
      ],
      sections: [
        { title: "组合指标", headers: metricHeaders, rows: metricRows() },
        {
          title: "组合权重",
          headers: ["组合", ...result.assets],
          rows: result.portfolios.map((p) => [p.label, ...p.weights.map(pct)]),
        },
        {
          title: "年化样本协方差",
          headers: ["资产", ...result.assets],
          rows: result.assets.map((a, i) => [
            a,
            ...result.covariance[i].map((v) => num(v, 8)),
          ]),
        },
        { title: "解读", text: result.insight },
      ],
      notes: [
        `日期 ${result.dates[0]} 至 ${result.dates.at(-1)}；每年 ${result.settings.periodsPerYear} 期；年化无风险利率 ${pct(result.settings.annualRiskFree)}。`,
        "算术年化均值不是 CAGR；均值方差 Sharpe 使用年化均值、年化无风险利率与年化波动。",
        "历史净值假设每期再平衡、不收费。有限网格最佳不等于连续全局最优，不代表未来配置建议。",
        ...result.warnings,
      ],
    }),
    "text/html;charset=utf-8",
  );
};
await init();
