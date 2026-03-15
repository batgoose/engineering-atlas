#!/usr/bin/env node
/**
 * scrape_nflmockdraftdb_mock_drafts.mjs
 *
 * Playwright scraper for nflmockdraftdatabase.com mock draft pages.
 * Each individual mock draft page embeds all picks in a data-react-props
 * attribute on a React root element — no DOM scraping required, just JSON parsing.
 *
 * Usage:
 *   node scrape_nflmockdraftdb_mock_drafts.mjs --season 2026 --output-json /path/out.json
 *   node scrape_nflmockdraftdb_mock_drafts.mjs --season 2026 --mock-slug espn-2026-field-yates --output-json /path/out.json
 *   node scrape_nflmockdraftdb_mock_drafts.mjs --season 2026 --dry-run
 *
 * Output JSON structure:
 * {
 *   "season": 2026,
 *   "scraped_at": "2026-03-10T12:00:00.000Z",
 *   "mocks": [
 *     {
 *       "slug": "espn-2026-field-yates",
 *       "source_key": "nflmockdraftdb_field_yates_mock",
 *       "source_label": "Field Yates (ESPN)",
 *       "source_analyst": "Field Yates",
 *       "source_outlet": "ESPN",
 *       "source_url": "https://www.nflmockdraftdatabase.com/mock-drafts/2026/espn-2026-field-yates",
 *       "source_updated": "2026-03-09",
 *       "picks": [
 *         { "pick": 1, "round": 1, "player": {...}, "team": {...}, "blurb": null, "traded": null }
 *       ]
 *     }
 *   ]
 * }
 */

import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE_URL = 'https://www.nflmockdraftdatabase.com';
const DEFAULT_TIMEOUT_MS = 45_000;
const PAGE_SETTLE_MS = 2_500;

// Curated professional mock drafts — add new sources here as they appear
const KNOWN_MOCKS = [
  {
    slug: 'mock-draft-2026',
    source_key: 'nflmockdraftdb_official_mock',
    source_analyst: null,
    source_outlet: 'NFLMockDraftDatabase',
    source_label: 'Official MDDB Mock Draft',
  },
  {
    slug: 'espn-2026-field-yates',
    source_key: 'nflmockdraftdb_field_yates_mock',
    source_analyst: 'Field Yates',
    source_outlet: 'ESPN',
    source_label: 'Field Yates (ESPN)',
  },
  {
    slug: 'fox-sports-2026-bucky-brooks',
    source_key: 'nflmockdraftdb_bucky_brooks_mock',
    source_analyst: 'Bucky Brooks',
    source_outlet: 'Fox Sports',
    source_label: 'Bucky Brooks (Fox Sports)',
  },
  {
    slug: 'usa-today-2026-nate-davis',
    source_key: 'nflmockdraftdb_nate_davis_mock',
    source_analyst: 'Nate Davis',
    source_outlet: 'USA Today',
    source_label: 'Nate Davis (USA Today)',
  },
  {
    slug: 'usa-today-2026-michael-middlehurst-schwartz',
    source_key: 'nflmockdraftdb_middlehurst_schwartz_mock',
    source_analyst: 'Michael Middlehurst-Schwartz',
    source_outlet: 'USA Today',
    source_label: 'Michael Middlehurst-Schwartz (USA Today)',
  },
  {
    slug: 'pro-football-focus-2026-max-chadwick',
    source_key: 'nflmockdraftdb_max_chadwick_mock',
    source_analyst: 'Max Chadwick',
    source_outlet: 'PFF',
    source_label: 'Max Chadwick (PFF)',
  },
  {
    slug: 'the-athletic-2026-nick-baumgardner',
    source_key: 'nflmockdraftdb_nick_baumgardner_mock',
    source_analyst: 'Nick Baumgardner',
    source_outlet: 'The Athletic',
    source_label: 'Nick Baumgardner (The Athletic)',
  },
  {
    slug: 'pro-football-network-2026-jacob-infante',
    source_key: 'nflmockdraftdb_jacob_infante_mock',
    source_analyst: 'Jacob Infante',
    source_outlet: 'Pro Football Network',
    source_label: 'Jacob Infante (Pro Football Network)',
  },
  {
    slug: 'athlon-sports-2026-luke-easterling',
    source_key: 'nflmockdraftdb_luke_easterling_mock',
    source_analyst: 'Luke Easterling',
    source_outlet: 'Athlon Sports',
    source_label: 'Luke Easterling (Athlon Sports)',
  },
  {
    slug: 'si-2026-mark-morales-smith',
    source_key: 'nflmockdraftdb_mark_morales_smith_mock',
    source_analyst: 'Mark Morales-Smith',
    source_outlet: 'SI',
    source_label: 'Mark Morales-Smith (SI)',
  },
  {
    slug: 'for-the-win-2026-christian-d-andrea',
    source_key: 'nflmockdraftdb_christian_dandrea_mock',
    source_analyst: "Christian D'Andrea",
    source_outlet: 'For The Win',
    source_label: "Christian D'Andrea (For The Win)",
  },
  {
    slug: 'espn-2026-mel-kiper',
    source_key: 'nflmockdraftdb_mel_kiper_mock',
    source_analyst: 'Mel Kiper Jr.',
    source_outlet: 'ESPN',
    source_label: 'Mel Kiper Jr. (ESPN)',
  },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    season: parseInt(get('--season') || String(new Date().getFullYear()), 10),
    outputJson: get('--output-json'),
    mockSlug: get('--mock-slug') || '',
    mockSlugs: get('--mock-slugs') || '',
    dryRun: args.includes('--dry-run'),
  };
}

// ---------------------------------------------------------------------------
// Scrape one mock draft page — returns the selections array
// ---------------------------------------------------------------------------
async function scrapeMockPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(PAGE_SETTLE_MS);

  const result = await page.evaluate(() => {
    const el = document.querySelector('[data-react-props]');
    if (!el) return null;
    try {
      const data = JSON.parse(el.getAttribute('data-react-props'));
      const mock = data.mock || data;
      return {
        selections: mock.selections || [],
        publishedAt: mock.published_at || null,
      };
    } catch {
      return null;
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Parse date from nflmockdraftdb format "MM/DD/YY" → "YYYY-MM-DD"
// ---------------------------------------------------------------------------
function parsePublishedAt(raw) {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[3], 10) + 2000;
  return `${year}-${m[1]}-${m[2]}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { season, outputJson, mockSlug, mockSlugs, dryRun } = parseArgs();

  // Determine which mocks to scrape
  let targets = KNOWN_MOCKS;
  if (mockSlug) {
    targets = KNOWN_MOCKS.filter((m) => m.slug === mockSlug);
    if (!targets.length) {
      // Allow arbitrary slug with minimal metadata
      targets = [{ slug: mockSlug, source_key: `nflmockdraftdb_${mockSlug.replace(/-/g, '_')}`, source_analyst: null, source_outlet: '', source_label: mockSlug }];
    }
  } else if (mockSlugs) {
    const slugSet = new Set(mockSlugs.split(',').map((s) => s.trim()));
    targets = KNOWN_MOCKS.filter((m) => slugSet.has(m.slug));
  }

  process.stderr.write(`Scraping ${targets.length} mock draft(s) for season ${season}\n`);

  if (dryRun) {
    process.stderr.write('[dry-run] would scrape:\n');
    for (const t of targets) process.stderr.write(`  ${t.slug}\n`);
    process.stdout.write(JSON.stringify({ season, scraped_at: new Date().toISOString(), mocks: [] }, null, 2));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const results = [];

  for (const target of targets) {
    const url = `${BASE_URL}/mock-drafts/${season}/${target.slug}`;
    process.stderr.write(`  Scraping: ${target.source_label} — ${url}\n`);

    try {
      const data = await scrapeMockPage(page, url);
      if (!data || !data.selections.length) {
        process.stderr.write(`    WARNING: no picks found for ${target.slug}\n`);
        results.push({ ...target, source_url: url, source_updated: null, picks: [], error: 'no picks found' });
        continue;
      }

      const sourceUpdated = parsePublishedAt(data.publishedAt);
      process.stderr.write(`    Got ${data.selections.length} picks (updated ${sourceUpdated || 'unknown'})\n`);

      results.push({
        slug: target.slug,
        source_key: target.source_key,
        source_label: target.source_label,
        source_analyst: target.source_analyst,
        source_outlet: target.source_outlet,
        source_url: url,
        source_updated: sourceUpdated,
        picks: data.selections,
      });
    } catch (err) {
      process.stderr.write(`    ERROR scraping ${target.slug}: ${err.message}\n`);
      results.push({ ...target, source_url: url, source_updated: null, picks: [], error: err.message });
    }
  }

  await browser.close();

  const payload = {
    season,
    scraped_at: new Date().toISOString(),
    mocks: results,
  };

  const json = JSON.stringify(payload, null, 2);

  if (outputJson) {
    await fs.writeFile(outputJson, json, 'utf8');
    process.stderr.write(`\nWrote output to ${outputJson}\n`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
