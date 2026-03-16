#!/usr/bin/env node
/**
 * scrape_nflmockdraftdb_big_boards.mjs
 *
 * Playwright scraper for nflmockdraftdatabase.com big board pages.
 * Supports scraping individual boards or discovering all boards from the listing page.
 *
 * Usage:
 *   node scrape_nflmockdraftdb_big_boards.mjs --season 2026 --output-json /path/out.json
 *   node scrape_nflmockdraftdb_big_boards.mjs --season 2026 --board-slug consensus-big-board-2026 --output-json /path/out.json
 *   node scrape_nflmockdraftdb_big_boards.mjs --season 2026 --board-slugs "consensus-big-board-2026,nfl-com-2026-daniel-jeremiah-big-board" --output-json /path/out.json
 *
 * Output JSON structure:
 * {
 *   "season": 2026,
 *   "scraped_at": "2026-03-10T12:00:00.000Z",
 *   "boards": [
 *     {
 *       "slug": "nfl-com-2026-daniel-jeremiah-big-board",
 *       "source_key": "nflmockdraftdb_daniel_jeremiah",
 *       "source_label": "Daniel Jeremiah (NFL.com)",
 *       "source_analyst": "Daniel Jeremiah",
 *       "source_outlet": "NFL.com",
 *       "source_url": "https://www.nflmockdraftdatabase.com/big-boards/2026/nfl-com-2026-daniel-jeremiah-big-board",
 *       "source_updated": "2026-03-05",
 *       "entries": [
 *         { "rank": 1, "name": "Fernando Mendoza", "name_slug": "fernando-mendoza", "position": "QB", "school": "Indiana" },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'https://www.nflmockdraftdatabase.com';
const DEFAULT_TIMEOUT_MS = 45_000;
const PAGE_SETTLE_MS = 2_000;

// Known board slugs with their metadata — add new sources here as they appear
const KNOWN_BOARDS = [
  {
    slug: 'consensus-big-board-2026',
    source_key: 'nflmockdraftdb_consensus',
    source_label: 'Consensus Big Board',
    source_analyst: null,
    source_outlet: 'NFLMockDraftDatabase',
  },
  {
    slug: 'nfl-com-2026-daniel-jeremiah-big-board',
    source_key: 'nflmockdraftdb_daniel_jeremiah',
    source_label: 'Daniel Jeremiah (NFL.com)',
    source_analyst: 'Daniel Jeremiah',
    source_outlet: 'NFL.com',
  },
  {
    slug: 'the-athletic-2026-dane-brugler-big-board',
    source_key: 'nflmockdraftdb_dane_brugler',
    source_label: 'Dane Brugler (The Athletic)',
    source_analyst: 'Dane Brugler',
    source_outlet: 'The Athletic',
  },
  {
    slug: 'the-draft-network-2026-big-board',
    source_key: 'nflmockdraftdb_the_draft_network',
    source_label: 'The Draft Network',
    source_analyst: null,
    source_outlet: 'The Draft Network',
  },
  {
    slug: 'espn-2026-field-yates-big-board',
    source_key: 'nflmockdraftdb_field_yates',
    source_label: 'Field Yates (ESPN)',
    source_analyst: 'Field Yates',
    source_outlet: 'ESPN',
  },
  {
    slug: 'tankathon-2026-big-board',
    source_key: 'nflmockdraftdb_tankathon',
    source_label: 'Tankathon',
    source_analyst: null,
    source_outlet: 'Tankathon',
  },
  {
    slug: 'bleacher-report-2026-big-board',
    source_key: 'nflmockdraftdb_bleacher_report',
    source_label: 'Bleacher Report',
    source_analyst: null,
    source_outlet: 'Bleacher Report',
  },
  {
    slug: 'fox-sports-2026-rob-rang-big-board',
    source_key: 'nflmockdraftdb_rob_rang',
    source_label: 'Rob Rang (Fox Sports)',
    source_analyst: 'Rob Rang',
    source_outlet: 'Fox Sports',
  },
  {
    slug: 'cbs-2026-michael-renner-big-board',
    source_key: 'nflmockdraftdb_michael_renner',
    source_label: 'Michael Renner (CBS Sports)',
    source_analyst: 'Michael Renner',
    source_outlet: 'CBS Sports',
  },
  {
    slug: 'cbs-2026-ryan-wilson-big-board',
    source_key: 'nflmockdraftdb_ryan_wilson',
    source_label: 'Ryan Wilson (CBS Sports)',
    source_analyst: 'Ryan Wilson',
    source_outlet: 'CBS Sports',
  },
  {
    slug: 'yahoo-2026-charles-mcdonald-big-board',
    source_key: 'nflmockdraftdb_charles_mcdonald',
    source_label: 'Charles McDonald (Yahoo Sports)',
    source_analyst: 'Charles McDonald',
    source_outlet: 'Yahoo Sports',
  },
];

function parseArgs(argv) {
  const args = {
    season: null,
    outputJson: '',
    boardSlug: null,
    boardSlugs: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--season' && next) { args.season = parseInt(next, 10); i += 1; continue; }
    if (token === '--output-json' && next) { args.outputJson = next; i += 1; continue; }
    if (token === '--board-slug' && next) { args.boardSlug = next; i += 1; continue; }
    if (token === '--board-slugs' && next) { args.boardSlugs = next.split(',').map(s => s.trim()).filter(Boolean); i += 1; continue; }
    if (token === '--timeout-ms' && next) { args.timeoutMs = parseInt(next, 10); i += 1; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
  }

  if (!Number.isFinite(args.season) || args.season < 2020) {
    throw new Error('Missing or invalid --season <year>. Example: --season 2026');
  }
  if (!args.outputJson && !args.dryRun) {
    throw new Error('Missing required --output-json <path> argument.');
  }

  return args;
}

/**
 * Parse a date string like "03/05/26" or "03/05/2026" → "2026-03-05"
 */
function parseShortDate(raw, season) {
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, mm, dd, yy] = match;
  const year = yy.length === 2 ? parseInt(`20${yy}`, 10) : parseInt(yy, 10);
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Scrape a single big board page. Returns { source_updated, entries }.
 */
async function scrapeBoardPage(page, boardUrl, timeoutMs) {
  await page.goto(boardUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
  await page.waitForTimeout(PAGE_SETTLE_MS);

  return page.evaluate(() => {
    // Find all unique player list items by player link
    const playerLinks = document.querySelectorAll('a[href*="/players/2026/"]');
    const seen = new Set();
    const entries = [];

    playerLinks.forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const li = a.closest('li');
      if (!li) return;

      // Rank: large bold number in the first div
      const rankEl = li.querySelector('div[style*="font-size: 30px"]');
      const rank = rankEl ? parseInt(rankEl.innerText.trim(), 10) : null;
      if (!rank || !Number.isFinite(rank)) return;

      // Name: from aria-label attribute (most reliable)
      const name = (a.getAttribute('aria-label') || a.innerText || '').trim();
      const nameSlug = href.split('/').pop() || '';

      // Position + school: second and third lines of text (after rank + name)
      const allLines = li.innerText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      // allLines is typically: ["1", "Fernando Mendoza", "QB", "Indiana"]
      // Find the index of the name line and take the next two
      const nameIdx = allLines.findIndex((l) => l === name);
      const position = nameIdx >= 0 ? (allLines[nameIdx + 1] || '') : (allLines[2] || '');
      const school = nameIdx >= 0 ? (allLines[nameIdx + 2] || '') : (allLines[3] || '');

      entries.push({ rank, name, name_slug: nameSlug, position, school });
    });

    // Sort by rank ascending for clean output
    entries.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    // Try to find board date — look for "MM/DD/YY" pattern in body text
    const bodyText = document.body.innerText;
    const dateMatch = bodyText.match(/\b(\d{2}\/\d{2}\/\d{2,4})\b/);
    const rawDate = dateMatch ? dateMatch[1] : null;

    return { rawDate, entries };
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  // Determine which boards to scrape
  let boardsToScrape;
  if (args.boardSlug) {
    const meta = KNOWN_BOARDS.find((b) => b.slug === args.boardSlug);
    if (!meta) {
      // Allow unknown slugs — use slug as source_key
      boardsToScrape = [{
        slug: args.boardSlug,
        source_key: `nflmockdraftdb_${args.boardSlug.replace(/-/g, '_')}`,
        source_label: args.boardSlug,
        source_analyst: null,
        source_outlet: null,
      }];
    } else {
      boardsToScrape = [meta];
    }
  } else if (args.boardSlugs) {
    boardsToScrape = args.boardSlugs.map((slug) => {
      return KNOWN_BOARDS.find((b) => b.slug === slug) || {
        slug,
        source_key: `nflmockdraftdb_${slug.replace(/-/g, '_')}`,
        source_label: slug,
        source_analyst: null,
        source_outlet: null,
      };
    });
  } else {
    // Default: scrape all known boards
    boardsToScrape = KNOWN_BOARDS;
  }

  console.error(`[big-boards] Scraping ${boardsToScrape.length} board(s) for season ${args.season}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const results = [];
  const scrapedAt = new Date().toISOString();

  for (const boardMeta of boardsToScrape) {
    const boardUrl = `${BASE_URL}/big-boards/${args.season}/${boardMeta.slug}`;
    console.error(`[big-boards] → ${boardMeta.source_label} (${boardUrl})`);

    try {
      const { rawDate, entries } = await scrapeBoardPage(page, boardUrl, args.timeoutMs);
      const sourceUpdated = parseShortDate(rawDate, args.season);

      console.error(`[big-boards]   ✓ ${entries.length} entries, updated ${sourceUpdated ?? 'unknown'}`);

      results.push({
        slug: boardMeta.slug,
        source_key: boardMeta.source_key,
        source_label: boardMeta.source_label,
        source_analyst: boardMeta.source_analyst ?? null,
        source_outlet: boardMeta.source_outlet ?? null,
        source_url: boardUrl,
        source_updated: sourceUpdated,
        entries,
      });
    } catch (err) {
      console.error(`[big-boards]   ✗ Failed: ${err.message}`);
      results.push({
        slug: boardMeta.slug,
        source_key: boardMeta.source_key,
        source_label: boardMeta.source_label,
        source_analyst: boardMeta.source_analyst ?? null,
        source_outlet: boardMeta.source_outlet ?? null,
        source_url: boardUrl,
        source_updated: null,
        error: err.message,
        entries: [],
      });
    }
  }

  await browser.close();

  const output = {
    season: args.season,
    scraped_at: scrapedAt,
    boards: results,
  };

  if (args.dryRun) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    const outPath = path.resolve(args.outputJson);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.error(`[big-boards] Output written to ${outPath}`);
  }
}

run().catch((err) => {
  console.error('[big-boards] Fatal error:', err);
  process.exit(1);
});
