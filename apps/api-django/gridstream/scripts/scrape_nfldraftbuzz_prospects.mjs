#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'https://www.nfldraftbuzz.com';
const DEFAULT_LIMIT = Number.MAX_SAFE_INTEGER;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = {
    season: null,
    limit: DEFAULT_LIMIT,
    limitProvided: false,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    savedHtmlDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--season' && next) {
      args.season = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token === '--limit' && next) {
      args.limit = Number.parseInt(next, 10);
      args.limitProvided = true;
      index += 1;
      continue;
    }
    if (token === '--concurrency' && next) {
      args.concurrency = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token === '--timeout-ms' && next) {
      args.timeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token === '--saved-html-dir' && next) {
      args.savedHtmlDir = next;
      index += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.season)) {
    throw new Error('Missing required --season <year> argument.');
  }
  if (!args.savedHtmlDir) {
    throw new Error('Missing required --saved-html-dir <path> argument.');
  }

  if (args.limitProvided) {
    args.limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : DEFAULT_LIMIT;
  } else {
    args.limit = DEFAULT_LIMIT;
  }
  args.concurrency =
    Number.isFinite(args.concurrency) && args.concurrency > 0
      ? args.concurrency
      : DEFAULT_CONCURRENCY;
  args.timeoutMs =
    Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_TIMEOUT_MS;

  return args;
}

function toAbsoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(String(value), BASE_URL).href;
  } catch (_error) {
    return null;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function listSavedHtmlFiles(savedHtmlDir) {
  const dirPath = path.resolve(savedHtmlDir);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function extractPortraitImageFromSavedHtml(html) {
  const match = String(html ?? '').match(
    /<figure[^>]*class="[^"]*player-info__photo[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i
  );
  const raw = String(match?.[1] ?? '')
    .replace(/&amp;/g, '&')
    .trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    return toAbsoluteUrl(raw);
  }
  const fileName = raw.split(/[\\/]/).pop()?.split('?')[0]?.split('#')[0] || '';
  if (!fileName || /noImage1\.png$/i.test(fileName)) {
    return null;
  }
  const normalizedFileName = fileName.replace(/_\d+(\.[a-z0-9]+)$/i, '$1');
  return toAbsoluteUrl(`/Content/PlayerHeadShots/${normalizedFileName}`);
}

async function waitForProspectPageReady(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return {
        hasHeading:
          Boolean(
            document.querySelector(
              'h1.post__title_Player, h1.post__title_Player.d-none.d-sm-block, .player-info__first-name'
            )
          ) || Boolean(document.querySelector('.player-info__last-name')),
        hasScoutingContent:
          bodyText.includes('Draft Profile: Bio') ||
          bodyText.includes('Scouting Report: Strengths') ||
          bodyText.includes('Scouting Report: Summary') ||
          bodyText.includes('NFL Draft Profile'),
      };
    });

    if (state.hasHeading && state.hasScoutingContent) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for prospect page content after ${timeoutMs}ms.`);
}

async function extractProspectDetail(page) {
  return page.evaluate(() => {
    const clean = (value) =>
      String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const absWeb = (value) => {
      if (!value) return null;
      try {
        return new URL(String(value), 'https://www.nfldraftbuzz.com').href;
      } catch (_error) {
        return null;
      }
    };
    const absAsset = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
        const resolved = absWeb(raw);
        if (resolved && /\/assets\/images\/noImage1\.png$/i.test(resolved)) {
          return null;
        }
        return resolved;
      }
      return null;
    };
    const portraitImage = (() => {
      const raw = String(
        document.querySelector('.player-info__photo img')?.getAttribute('src') ?? ''
      ).trim();
      if (!raw) return null;
      if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
        return absAsset(raw);
      }
      const fileName = raw.split(/[\\/]/).pop()?.split('?')[0]?.split('#')[0] || '';
      if (!fileName || /noImage1\.png$/i.test(fileName)) {
        return null;
      }
      return absWeb(`/Content/PlayerHeadShots/${fileName}`);
    })();
    const toFloat = (value) => {
      const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
      return match ? Number.parseFloat(match[0]) : null;
    };
    const toInt = (value) => {
      const match = String(value ?? '').match(/-?\d+/);
      return match ? Number.parseInt(match[0], 10) : null;
    };
    const parseUsDateInner = (value) => {
      const match = String(value ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!match) return null;
      return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    };
    const queryAll = (selector, root = document) =>
      root ? Array.from(root.querySelectorAll(selector)) : [];

    const basicInfoTable =
      document.querySelector('table.basicInfoTable.topMeasurables') ||
      document.querySelector('table.basicInfoTable');
    const basicInfoText = clean(basicInfoTable?.innerText);
    const measurableTable = queryAll('table.starRatingTable').find((table) =>
      clean(table.innerText).includes('Measurables:')
    );
    const measurableText = clean(measurableTable?.innerText);
    const overviewTable = queryAll('table.starRatingTable').find((table) =>
      clean(table.innerText).includes('Overall Rating:')
    );
    const overviewText = clean(overviewTable?.innerText);
    const rankingBoxText = clean(document.querySelector('.rankingBox')?.innerText);

    const basicDetails = {};
    for (const item of queryAll('.player-info-details__item')) {
      const label = clean(
        item.querySelector('.player-info-details__title')?.textContent
      ).toLowerCase();
      const value = clean(item.querySelector('.player-info-details__value')?.textContent);
      if (label && value) {
        basicDetails[label] = value;
      }
    }

    const sectionByHeading = (headingText) =>
      queryAll('h5.proNegHeader').find(
        (heading) => clean(heading.textContent).toLowerCase() === headingText.toLowerCase()
      )?.parentElement || null;

    const sectionBodyText = (headingText) => {
      const container = sectionByHeading(headingText);
      if (!container) return '';
      const body = clean(container.innerText);
      const heading = clean(container.querySelector('h5.proNegHeader')?.textContent || headingText);
      return clean(body.replace(heading, ''));
    };

    const headingTitle = clean(
      document.querySelector('h1.post__title_Player.d-none.d-sm-block')?.textContent ||
        document.querySelector('h1.post__title_Player')?.textContent
    );
    const headingMatch = headingTitle.match(/^(.*?)\s+([A-Z/]+)\s+(.+?)\s+\|\s+NFL Draft Profile/i);

    const ratingCards = queryAll('.player-info-stats__item .circular').map((card) => {
      const strong = clean(card.querySelector('.circular__label strong')?.textContent);
      const label = clean(card.querySelector('.circular__label')?.textContent)
        .replace(strong, '')
        .trim();
      const value = clean(card.querySelector('.circular__percents')?.textContent)
        .replace(/\/100$/, '')
        .trim();
      const percent = toFloat(card.querySelector('.circular__bar')?.getAttribute('data-percent'));
      return {
        label: clean(`${strong} ${label}`),
        value,
        percent,
      };
    });

    const productionStats = queryAll('.player-info__item--stats-inner > .row')
      .map((row) => {
        const label = clean(row.querySelector('.progress__label.col-5')?.textContent);
        const value = clean(row.querySelector('.progress__label.col-1')?.textContent);
        const title = clean(row.querySelector('.meter')?.getAttribute('title'));
        const percentileMatch = title.match(/(\d+)%/);
        if (!label) return null;
        return {
          label,
          value: value || null,
          percentile: percentileMatch ? Number.parseInt(percentileMatch[1], 10) : null,
        };
      })
      .filter(Boolean);

    const parsePercentileRow = (label) => {
      const pattern = new RegExp(`${label}:\\s*([^()]+?)\\s*\\((\\d+)%\\*\\)`, 'i');
      const match = measurableText.match(pattern);
      if (!match) return null;
      return {
        label,
        value: clean(match[1]),
        percentile: Number.parseInt(match[2], 10),
      };
    };

    const measurablePercentiles = [
      parsePercentileRow('Height'),
      parsePercentileRow('Weight'),
      parsePercentileRow('Hands'),
      parsePercentileRow('Arm'),
      parsePercentileRow('Forty'),
    ].filter(Boolean);

    const parseGradeValue = (label, suffix = '') => {
      const pattern = new RegExp(`${label}:\\s*([^%]+${suffix})`, 'i');
      const match = overviewText.match(pattern);
      return match ? clean(match[1]) : null;
    };
    const overviewValueByLabel = {};
    for (const row of queryAll('tbody tr', overviewTable)) {
      const cells = queryAll('td', row);
      if (!cells.length) continue;
      const rawLabel = clean(cells[0]?.textContent);
      if (!rawLabel || /average rating of opposition|click the links below/i.test(rawLabel)) {
        continue;
      }
      const label = clean(rawLabel.replace(/:$/, ''));
      const tailValue = clean(cells[cells.length - 1]?.textContent);
      const middleValue = clean(cells[1]?.textContent);
      const value =
        cells.length >= 3 ? tailValue || middleValue || null : middleValue || tailValue || null;
      if (label && value) {
        overviewValueByLabel[label] = value;
      }
    }

    const scoutingGrades = [
      {
        label: 'Player Rating',
        value: ratingCards[0]?.value || null,
        percent: ratingCards[0]?.percent || null,
      },
      {
        label: 'Position Rank',
        value: ratingCards[1]?.value || null,
        percent: ratingCards[1]?.percent || null,
      },
      {
        label: 'Forty YD Time',
        value: ratingCards[2]?.value || null,
        percent: ratingCards[2]?.percent || null,
      },
      {
        label: 'Offense Rating',
        value: overviewValueByLabel['Offense Rating'] || parseGradeValue('Offense Rating', '%'),
      },
      {
        label: 'QB Rating When targeted',
        value:
          overviewValueByLabel['QB Rating When targeted'] ||
          parseGradeValue('QB Rating When targeted'),
      },
      {
        label: 'Tackling',
        value: overviewValueByLabel['Tackling'] || parseGradeValue('Tackling', '%'),
      },
      {
        label: 'Run Defense',
        value: overviewValueByLabel['Run Defense'] || parseGradeValue('Run Defense', '%'),
      },
      {
        label: 'Coverage',
        value: overviewValueByLabel['Coverage'] || parseGradeValue('Coverage', '%'),
      },
      { label: 'Zone', value: overviewValueByLabel['Zone'] || parseGradeValue('Zone', '%') },
      {
        label: 'Man/Press',
        value: overviewValueByLabel['Man/Press'] || parseGradeValue('Man/Press', '%'),
      },
    ].filter((entry) => entry.value != null && entry.value !== '');

    const recruitingRatings = [
      {
        label: 'ESPN',
        value: clean((overviewText.match(/ESPN RATING:\s*([0-9/]+)/i) || [])[1]),
      },
      {
        label: '247',
        value: clean((overviewText.match(/247 RATING:\s*([0-9/]+)/i) || [])[1]),
      },
      {
        label: 'Rivals',
        value: clean((overviewText.match(/RIVALS RATING:\s*([0-9.]+(?:\s*\(\d+%\))?)/i) || [])[1]),
      },
    ].filter((entry) => entry.value);

    const comparisonHeader = queryAll('th').find((cell) =>
      clean(cell.textContent).toLowerCase().startsWith('player comparison')
    );
    const comparisonTable = comparisonHeader?.closest('table');
    const comparisonPlayers = comparisonTable
      ? queryAll('tbody tr', comparisonTable)
          .map((row) => {
            const link = row.querySelector('a[href^="/Player/"]');
            const cells = row.querySelectorAll('td');
            if (!link || cells.length < 3) return null;
            const nameSchool = clean(link.textContent).replace(/\s+-\s+/g, ' - ');
            const [namePart, schoolPart] = nameSchool.split(' - ');
            return {
              name: clean(namePart),
              school: clean(schoolPart),
              similarity: toInt(cells[2]?.textContent),
              source_url: absWeb(link.getAttribute('href')),
            };
          })
          .filter(Boolean)
      : [];

    const sourceUrl = absWeb(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href
    );
    const ogImage = absWeb(
      document.querySelector('meta[property="og:image"]')?.getAttribute('content')
    );
    const twitterImage = absWeb(
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
    );
    const sourceSlug = clean(
      String(sourceUrl || '')
        .replace(/^https?:\/\/[^/]+\/(?:Player|player)\//, '')
        .replace(/^\/(?:Player|player)\//, '')
        .replace(/[?#].*$/, '')
    );

    return {
      source_slug: sourceSlug,
      source_url: sourceUrl,
      source_label: 'NFLDraftBuzz scouting report',
      name:
        clean(
          `${document.querySelector('.player-info__first-name')?.textContent || ''} ${
            document.querySelector('.player-info__last-name')?.textContent || ''
          }`
        ) || clean(headingMatch?.[1]),
      position: basicDetails.position || clean(headingMatch?.[2]),
      school: basicDetails.college || clean(headingMatch?.[3]),
      class_year: basicDetails.class || null,
      hometown: basicDetails['home town'] || null,
      role: clean((basicInfoText.match(/ROLE:\s*(.+?)\s+Last Updated:/i) || [])[1]) || null,
      jersey_number: clean((basicInfoText.match(/Jersey:\s*#?([A-Za-z0-9]+)/i) || [])[1]),
      image_url: portraitImage || twitterImage || ogImage,
      college_logo_url: absAsset(
        document.querySelector('.player-info-col-logo img')?.getAttribute('src')
      ),
      draft_year: toInt((basicInfoText.match(/Draft Year:\s*(\d{4})/i) || [])[1]),
      source_last_updated: parseUsDateInner(
        (basicInfoText.match(/Last Updated:\s*([0-9/]+)/i) || [])[1]
      ),
      buzz_overall_rating: toFloat((overviewText.match(/Overall Rating:\s*([0-9.]+)/i) || [])[1]),
      buzz_overall_rank: toInt((overviewText.match(/Overall Rank:\s*#?(\d+)/i) || [])[1]),
      buzz_position_rank: toInt((overviewText.match(/Position rank:\s*#?(\d+)/i) || [])[1]),
      buzz_position_rank_group: clean(
        (overviewText.match(/Position rank:\s*#?\d+\s*\(([^)]+)\)/i) || [])[1]
      ),
      draft_projection: clean(
        (overviewText.match(/Draft Projection:\s*(.+?)\s+Overall Rank:/i) || [])[1]
      ),
      all_scouts_overall_rank: toFloat(
        (rankingBoxText.match(/All Scouts Average\s*Overall Rank\s*([0-9.]+)/i) || [])[1]
      ),
      all_scouts_position_rank: toFloat(
        (rankingBoxText.match(/All Scouts Average\s*Position Rank\s*([0-9.]+)/i) || [])[1]
      ),
      height: basicDetails.height || clean((measurableText.match(/Height:\s*([0-9-]+)/i) || [])[1]),
      weight: toInt(basicDetails.weight || (measurableText.match(/Weight:\s*([0-9]+)/i) || [])[1]),
      forty_yard: toFloat(
        (basicInfoText.match(/FORTY time:\s*([0-9.]+)/i) || [])[1] ||
          (measurableText.match(/Forty:\s*([0-9.]+)/i) || [])[1]
      ),
      hand_size: clean((measurableText.match(/Hands:\s*([^()]+?)\s*\(\d+%\*\)/i) || [])[1]),
      arm_length: clean((measurableText.match(/Arm:\s*([^()]+?)\s*\(\d+%\*\)/i) || [])[1]),
      age: toFloat((basicInfoText.match(/Age:\s*([0-9.]+)/i) || [])[1]),
      birth_date: parseUsDateInner((basicInfoText.match(/DOB:\s*([0-9/]+)/i) || [])[1]),
      college_games: toInt((overviewText.match(/College Games:\s*(\d+)/i) || [])[1]),
      college_snaps: toInt((overviewText.match(/College Snaps:\s*(\d+)/i) || [])[1]),
      bio: sectionBodyText('Draft Profile: Bio') || null,
      summary: sectionBodyText('Scouting Report: Summary') || null,
      strengths: queryAll('li', sectionByHeading('Scouting Report: Strengths')).map((item) =>
        clean(item.textContent)
      ),
      weaknesses: queryAll('li', sectionByHeading('Scouting Report: Weaknesses')).map((item) =>
        clean(item.textContent)
      ),
      honors: queryAll('li', sectionByHeading('Honors & awards')).map((item) =>
        clean(item.textContent)
      ),
      production_stats: productionStats,
      scouting_grades: scoutingGrades,
      measurable_percentiles: measurablePercentiles,
      recruiting_ratings: recruitingRatings,
      comparison_players: comparisonPlayers,
    };
  });
}

async function scrapeProspectDetailFromSavedHtml(page, filePath, timeoutMs) {
  const html = await fs.readFile(filePath, 'utf8');
  const portraitImageUrl = extractPortraitImageFromSavedHtml(html);
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await waitForProspectPageReady(page, timeoutMs);
  const detail = await extractProspectDetail(page);
  return portraitImageUrl ? { ...detail, image_url: portraitImageUrl } : detail;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 2200 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  try {
    const savedFiles = await listSavedHtmlFiles(args.savedHtmlDir);
    const trimmedFiles = savedFiles.slice(0, args.limit);
    let detailRows = await mapWithConcurrency(trimmedFiles, args.concurrency, async (filePath) => {
      const page = await context.newPage();
      try {
        const detail = await scrapeProspectDetailFromSavedHtml(page, filePath, args.timeoutMs);
        return detail;
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'warn',
            message: 'Failed to parse saved NFLDraftBuzz HTML',
            file: filePath,
            error: String(error?.message || error),
          })
        );
        return null;
      } finally {
        await page.close();
      }
    });
    detailRows = detailRows.filter(Boolean);

    const payload = {
      source: 'nfldraftbuzz',
      season: args.season,
      scraped_at: new Date().toISOString(),
      source_url: path.resolve(args.savedHtmlDir),
      prospects: detailRows.map((row) => ({
        ...row,
        source_url: toAbsoluteUrl(row.source_url),
        image_url: toAbsoluteUrl(row.image_url),
        college_logo_url: toAbsoluteUrl(row.college_logo_url),
      })),
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
