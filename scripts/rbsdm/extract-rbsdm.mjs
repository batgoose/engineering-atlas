#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const { chromium } = await import("playwright");

const DEFAULTS = {
  outDir: "tmp/rbsdm_exports",
  statsStart: 2016,
  statsEnd: 2025,
  statsWeeks: 18,
  qbOnly: false,
  luckStart: 1999,
  luckEnd: 2025,
  luckWeeks: 21,
  includePassFreqYearly: false,
  passFreqStart: 1999,
  passFreqEnd: 2025,
  timeoutMs: 180000,
  headful: false,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return {
    outDir: args["out-dir"] ?? DEFAULTS.outDir,
    statsStart: parseInt(args["stats-start"] ?? DEFAULTS.statsStart, 10),
    statsEnd: parseInt(args["stats-end"] ?? DEFAULTS.statsEnd, 10),
    statsWeeks: parseInt(args["stats-weeks"] ?? DEFAULTS.statsWeeks, 10),
    qbOnly: args["qb-only"] === true || args["qb-only"] === "true",
    luckStart: parseInt(args["luck-start"] ?? DEFAULTS.luckStart, 10),
    luckEnd: parseInt(args["luck-end"] ?? DEFAULTS.luckEnd, 10),
    luckWeeks: parseInt(args["luck-weeks"] ?? DEFAULTS.luckWeeks, 10),
    includePassFreqYearly:
      args["include-passfreq-yearly"] === true ||
      args["include-passfreq-yearly"] === "true",
    passFreqStart: parseInt(args["passfreq-start"] ?? DEFAULTS.passFreqStart, 10),
    passFreqEnd: parseInt(args["passfreq-end"] ?? DEFAULTS.passFreqEnd, 10),
    timeoutMs: parseInt(args["timeout-ms"] ?? DEFAULTS.timeoutMs, 10),
    headful: args.headful === true || args.headful === "true",
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ts() {
  return new Date().toISOString();
}

function slugifyHeader(value, index) {
  const base = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("%", "pct")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base) return base;
  return `col_${index + 1}`;
}

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((h, i) => {
    const base = slugifyHeader(h, i);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    return `${base}_${count + 1}`;
  });
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function captureTable(page, widgetId) {
  return page.evaluate((id) => {
    const widget = document.getElementById(id);
    if (!widget) return null;
    const table = widget.querySelector("table");
    if (!table) return null;

    const textify = (value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      if (value instanceof HTMLElement) {
        return (value.textContent || "").trim();
      }
      if (Array.isArray(value)) {
        return value.map(textify).join(" ").trim();
      }
      return String(value).trim();
    };

    const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
      textify(th.textContent),
    );

    let rows = [];
    try {
      const $ = window.jQuery;
      if ($ && $.fn && $.fn.dataTable) {
        const dt = $(table).DataTable();
        rows = dt
          .rows({ search: "applied" })
          .data()
          .toArray()
          .map((row) => {
            if (Array.isArray(row)) return row.map(textify);
            if (row && typeof row === "object") {
              return Object.values(row).map(textify);
            }
            return [textify(row)];
          });
      }
    } catch (_err) {
      // Fallback to DOM parsing below.
    }

    if (!rows.length) {
      rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.children).map((td) => textify(td.textContent)),
      );
    }

    return {
      headers,
      rows,
    };
  }, widgetId);
}

async function getText(page, elementId) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    return (el?.textContent || "").trim();
  }, elementId);
}

async function waitForContextText(page, elementId, requiredTokens, timeoutMs) {
  const tokens = Array.isArray(requiredTokens)
    ? requiredTokens
    : [requiredTokens];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const text = await getText(page, elementId);
    if (tokens.every((token) => text.includes(token))) {
      return text;
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for #${elementId} to include tokens: ${tokens.join(" | ")}`,
  );
}

async function waitForQbWeekContext(page, season, week, timeoutMs) {
  await page.waitForFunction(
    ({ expectedSeason, expectedWeek }) => {
      const text = (document.getElementById("qb_table_sub")?.textContent || "").trim();
      if (!text.includes(`${expectedSeason},`)) return false;

      const match = text.match(/reg\.\s*weeks\s+\d+\s*-\s*(\d+)/i);
      if (!match) return false;

      const endWeek = Number.parseInt(match[1], 10);
      if (!Number.isFinite(endWeek)) return false;
      return endWeek === expectedWeek;
    },
    { expectedSeason: season, expectedWeek: week },
    {
      timeout: timeoutMs,
    },
  );
}

async function waitForShinyReady(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      return (
        typeof window !== "undefined" &&
        !!window.Shiny &&
        typeof window.Shiny.setInputValue === "function"
      );
    },
    { timeout: timeoutMs },
  );
}

async function waitForTableState(page, widgetId, timeoutMs) {
  const start = Date.now();
  let stableTicks = 0;
  let lastSig = "";

  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate((id) => {
      const table = document.querySelector(`#${id} table`);
      const body = document.body;
      const busy =
        body.classList.contains("shiny-busy") ||
        body.classList.contains("recalculating");
      const loadingText = body.innerText.includes("Loading...");
      if (!table) {
        return { hasTable: false, busy, loadingText, rows: 0, first: "" };
      }
      const rows = table.querySelectorAll("tbody tr").length;
      const first =
        table.querySelector("tbody tr")?.textContent?.trim().slice(0, 140) || "";
      return { hasTable: true, busy, loadingText, rows, first };
    }, widgetId);

    const sig = `${state.rows}|${state.first}`;
    if (sig === lastSig) {
      stableTicks += 1;
    } else {
      stableTicks = 0;
      lastSig = sig;
    }

    // Normal finish path.
    if (state.hasTable && !state.busy && !state.loadingText) return state;

    // Some apps keep "Loading..." around while table is still usable.
    if (state.hasTable && stableTicks >= 8) return state;

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for table #${widgetId}`);
}

async function setRangeWeek(page, options) {
  await page.evaluate((opts) => {
    const shiny = window.Shiny;
    shiny.setInputValue(opts.rangeId, [opts.season, opts.season], {
      priority: "event",
    });
    shiny.setInputValue(opts.weekId, [opts.week, opts.week], {
      priority: "event",
    });
    if (opts.postId) {
      shiny.setInputValue(opts.postId, ["None", "None"], { priority: "event" });
    }
    if (typeof opts.qbMin === "number") {
      shiny.setInputValue("qb_min", opts.qbMin, { priority: "event" });
    }
  }, options);
}

async function setRangeOnly(page, options) {
  await page.evaluate((opts) => {
    const shiny = window.Shiny;
    shiny.setInputValue(opts.rangeId, [opts.season, opts.season], {
      priority: "event",
    });
    if (opts.weekId && typeof opts.weekStart === "number") {
      shiny.setInputValue(opts.weekId, [opts.weekStart, opts.weekEnd], {
        priority: "event",
      });
    }
    if (opts.postId) {
      shiny.setInputValue(opts.postId, ["None", "None"], { priority: "event" });
    }
  }, options);
}

function buildRecordContext(dataset, season, week, extra = {}) {
  return {
    dataset,
    season_start: season,
    season_end: season,
    week_start: week,
    week_end: week,
    captured_at: ts(),
    ...extra,
  };
}

function addTableRows(store, dataset, table, context) {
  if (!table) return;
  const headers = dedupeHeaders(table.headers);
  if (!store.fields[dataset]) {
    store.fields[dataset] = new Set([
      "dataset",
      "season_start",
      "season_end",
      "week_start",
      "week_end",
      "captured_at",
      "row_order",
      "table_context",
    ]);
  }

  for (const h of headers) store.fields[dataset].add(h);
  if (!store.rows[dataset]) store.rows[dataset] = [];

  table.rows.forEach((row, idx) => {
    const record = {
      ...context,
      row_order: idx + 1,
    };
    headers.forEach((key, colIdx) => {
      record[key] = row[colIdx] ?? "";
    });
    store.rows[dataset].push(record);
  });
}

async function writeDatasetCsv(outDir, dataset, rows, fieldsSet) {
  if (!rows || rows.length === 0) return null;

  const metaOrder = [
    "dataset",
    "season_start",
    "season_end",
    "week_start",
    "week_end",
    "table_context",
    "captured_at",
    "row_order",
  ];
  const allFields = Array.from(fieldsSet);
  const bodyFields = allFields
    .filter((f) => !metaOrder.includes(f))
    .sort((a, b) => a.localeCompare(b));
  const fields = [...metaOrder, ...bodyFields];

  const lines = [fields.join(",")];
  for (const row of rows) {
    lines.push(fields.map((f) => csvEscape(row[f] ?? "")).join(","));
  }

  const filePath = path.join(outDir, `${dataset}.csv`);
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function extractStats(page, cfg, store) {
  async function openStatsPage() {
    console.log(`[${ts()}] stats: open app`);
    await page.goto("https://rbsdm.com/stats/stats/", {
      waitUntil: "domcontentloaded",
      timeout: cfg.timeoutMs,
    });
    await sleep(2000);
    await waitForShinyReady(page, cfg.timeoutMs);
  }

  await openStatsPage();

  for (let season = cfg.statsStart; season <= cfg.statsEnd; season += 1) {
    const seasonMaxWeeks =
      season >= 2021 ? cfg.statsWeeks : Math.min(cfg.statsWeeks, 17);
    for (let week = 1; week <= seasonMaxWeeks; week += 1) {
      let done = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          console.log(
            `[${ts()}] stats: season=${season} week=${week} attempt=${attempt}`,
          );

          await setRangeWeek(page, {
            rangeId: "range",
            weekId: "weeks",
            postId: "weeks_post",
            qbMin: 15,
            season,
            week,
          });
          await page.click("#update");

          if (!cfg.qbOnly) {
            console.log(`[${ts()}] stats: offense tab render`);
            await page.click('a[data-value="Offense"]');
            await waitForContextText(
              page,
              "table_sub",
              [`${season},`, `reg. weeks ${week}-${week}`],
              cfg.timeoutMs,
            );
            await waitForTableState(page, "table1", cfg.timeoutMs);
            const offSub = await getText(page, "table_sub");
            const off = await captureTable(page, "table1");
            addTableRows(
              store,
              "stats_offense_weekly",
              off,
              buildRecordContext("stats_offense_weekly", season, week, {
                table_context: offSub,
              }),
            );

            console.log(`[${ts()}] stats: defense tab render`);
            await page.click('a[data-value="Defense"]');
            await waitForContextText(
              page,
              "table_sub2",
              [`${season},`, `reg. weeks ${week}-${week}`],
              Math.min(cfg.timeoutMs, 60000),
            );
            await waitForTableState(page, "table2", Math.min(cfg.timeoutMs, 60000));
            const defSub = await getText(page, "table_sub2");
            const def = await captureTable(page, "table2");
            addTableRows(
              store,
              "stats_defense_weekly",
              def,
              buildRecordContext("stats_defense_weekly", season, week, {
                table_context: defSub,
              }),
            );
          }

          console.log(`[${ts()}] stats: quarterbacks tab render`);
          await page.click('a[data-value="Quarterbacks"]');
          await waitForQbWeekContext(page, season, week, Math.min(cfg.timeoutMs, 60000));
          await waitForTableState(page, "table3", Math.min(cfg.timeoutMs, 60000));
          const qbSub = await getText(page, "qb_table_sub");
          const qb = await captureTable(page, "table3");
          addTableRows(
            store,
            "stats_qb_weekly",
            qb,
            buildRecordContext("stats_qb_weekly", season, week, {
              table_context: qbSub,
            }),
          );

          done = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[${ts()}] stats: retry season=${season} week=${week} attempt=${attempt} err=${err.message}`,
          );
          await openStatsPage();
        }
      }
      if (!done && lastErr) {
        console.error(
          `[${ts()}] stats: skipped season=${season} week=${week} after retries: ${lastErr.message}`,
        );
        continue;
      }
    }
  }
}

async function extractLuck(page, cfg, store) {
  async function openLuckPage() {
    console.log(`[${ts()}] luck: open app`);
    await page.goto("https://rbsdm.com/stats/luck/", {
      waitUntil: "domcontentloaded",
      timeout: cfg.timeoutMs,
    });
    await sleep(2000);
    await waitForShinyReady(page, cfg.timeoutMs);
  }

  await openLuckPage();

  for (let season = cfg.luckStart; season <= cfg.luckEnd; season += 1) {
    let defenseEnabled = true;
    for (let week = 1; week <= cfg.luckWeeks; week += 1) {
      let done = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          console.log(
            `[${ts()}] luck: season=${season} week=${week} attempt=${attempt}`,
          );

          await setRangeWeek(page, {
            rangeId: "range",
            weekId: "weeks",
            season,
            week,
          });

          console.log(`[${ts()}] luck: offense tab render`);
          await page.click("#update");
          await page.click('a[data-value="Offense"]');
          await waitForContextText(
            page,
            "table_sub",
            [`${season},`, `weeks ${week}-${week}`],
            cfg.timeoutMs,
          );
          await waitForTableState(page, "table_o", cfg.timeoutMs);
          const offSub = await getText(page, "table_sub");
          const off = await captureTable(page, "table_o");
          addTableRows(
            store,
            "luck_offense_weekly",
            off,
            buildRecordContext("luck_offense_weekly", season, week, {
              table_context: offSub,
            }),
          );

          if (defenseEnabled) {
            console.log(`[${ts()}] luck: defense tab render`);
            try {
              await page.click('a[data-value="Defense"]');
              await waitForContextText(
                page,
                "table_sub2",
                [`${season},`, `weeks ${week}-${week}`],
                Math.min(cfg.timeoutMs, 45000),
              );
              await waitForTableState(page, "table_d", Math.min(cfg.timeoutMs, 45000));
              const defSub = await getText(page, "table_sub2");
              const def = await captureTable(page, "table_d");
              addTableRows(
                store,
                "luck_defense_weekly",
                def,
                buildRecordContext("luck_defense_weekly", season, week, {
                  table_context: defSub,
                }),
              );
            } catch (defErr) {
              defenseEnabled = false;
              console.warn(
                `[${ts()}] luck: disabling defense for season=${season} after week=${week}: ${defErr.message}`,
              );
            }
          }

          done = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[${ts()}] luck: retry season=${season} week=${week} attempt=${attempt} err=${err.message}`,
          );
          await openLuckPage();
        }
      }
      if (!done && lastErr) {
        console.error(
          `[${ts()}] luck: skipped season=${season} week=${week} after retries: ${lastErr.message}`,
        );
        continue;
      }
    }
  }
}

async function extractPassFreqYearly(page, cfg, store) {
  console.log(`[${ts()}] pass_freq: open app`);
  for (let season = cfg.passFreqStart; season <= cfg.passFreqEnd; season += 1) {
    console.log(`[${ts()}] pass_freq: season=${season}`);
    await page.goto("https://rbsdm.com/stats/pass_freq/", {
      waitUntil: "domcontentloaded",
      timeout: cfg.timeoutMs,
    });
    await sleep(2000);
    await waitForShinyReady(page, cfg.timeoutMs);
    await page.click('a[data-value="Neutral pass freq"]');

    await setRangeOnly(page, {
      rangeId: "range",
      weekId: "weeks",
      postId: "weeks_post",
      season,
      weekStart: 1,
      weekEnd: 18,
    });

    await page.click("#update");
    await waitForContextText(
      page,
      "table_sub",
      [`${season},`, "reg. weeks 1-18"],
      cfg.timeoutMs,
    );
    await waitForTableState(page, "table", cfg.timeoutMs);
    const sub = await getText(page, "table_sub");
    const table = await captureTable(page, "table");
    addTableRows(
      store,
      "passfreq_neutral_yearly",
      table,
      {
        dataset: "passfreq_neutral_yearly",
        season_start: season,
        season_end: season,
        week_start: 1,
        week_end: 18,
        table_context: sub,
        captured_at: ts(),
      },
    );
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  console.log(`[${ts()}] config`, cfg);

  await ensureDir(cfg.outDir);

  const browser = await chromium.launch({
    headless: !cfg.headful,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
  });

  const store = {
    rows: {},
    fields: {},
  };

  try {
    await extractStats(page, cfg, store);
    await extractLuck(page, cfg, store);
    if (cfg.includePassFreqYearly) {
      await extractPassFreqYearly(page, cfg, store);
    }
  } finally {
    await browser.close();
  }

  const summary = {};
  for (const [dataset, rows] of Object.entries(store.rows)) {
    const filePath = await writeDatasetCsv(
      cfg.outDir,
      dataset,
      rows,
      store.fields[dataset],
    );
    summary[dataset] = {
      rows: rows.length,
      file: filePath,
    };
    console.log(`[${ts()}] wrote ${dataset}: ${rows.length} rows`);
  }

  const summaryPath = path.join(cfg.outDir, "summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[${ts()}] summary -> ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
