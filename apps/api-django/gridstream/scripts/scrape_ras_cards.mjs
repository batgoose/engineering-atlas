#!/usr/bin/env node
/**
 * scrape_ras_cards.mjs
 *
 * Playwright script that renders ras.football RAS card images and saves them
 * as PNG files. Called by the sync_ras_scores Django management command.
 *
 * The ras.football page uses html2canvas to render a #CardFrame element into
 * a <canvas> tag inside #PasteImage after a 1-second timeout. This script
 * waits for that canvas to appear, then screenshots it directly.
 *
 * Usage:
 *   node scrape_ras_cards.mjs --input /path/to/manifest.json
 *
 * Manifest format (JSON array):
 *   [
 *     {
 *       "ras_player_id": 4883,
 *       "team_overlay": "Commanders",   // empty string = no overlay (prospects)
 *       "output_path": "/tmp/ras/4883.png"
 *     },
 *     ...
 *   ]
 *
 * Each entry produces a PNG screenshot of the player's RAS card.
 * Entries that fail are logged but do not stop the batch.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const BASE_URL = 'https://ras.football/ras-information/';
const CANVAS_SELECTOR = '#PasteImage canvas';
const PAGE_TIMEOUT_MS = 20_000;
const CANVAS_WAIT_MS = 5_000;   // html2canvas fires after 1s, allow generous buffer

function buildUrl(rasPlayerId, teamOverlay) {
  const url = new URL(BASE_URL);
  url.searchParams.set('PlayerID', String(rasPlayerId));
  if (teamOverlay) {
    url.searchParams.set('ovl', teamOverlay);
  }
  return url.toString();
}

async function screenshotCard(page, entry, outDir) {
  const { ras_player_id, team_overlay, filename, html_path } = entry;
  const output_path = path.join(outDir, filename || `${ras_player_id}.png`);
  // Use local HTML file via file:// if available — bypasses Cloudflare entirely
  const url = html_path
    ? `file://${path.resolve(outDir, html_path)}`
    : buildUrl(ras_player_id, team_overlay);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

    // Wait for the canvas rendered by html2canvas to appear in #PasteImage
    await page.waitForSelector(CANVAS_SELECTOR, { timeout: CANVAS_WAIT_MS });

    const canvas = await page.$(CANVAS_SELECTOR);
    if (!canvas) {
      console.error(`  [${ras_player_id}] Canvas not found after waiting`);
      return false;
    }

    await canvas.screenshot({ path: output_path, type: 'png' });
    return true;
  } catch (err) {
    console.error(`  [${ras_player_id}] Error: ${err.message}`);
    return false;
  }
}

async function main() {
  // Parse --input argument
  const inputIdx = process.argv.indexOf('--input');
  if (inputIdx === -1 || !process.argv[inputIdx + 1]) {
    console.error('Usage: node scrape_ras_cards.mjs --input <manifest.json>');
    process.exit(1);
  }
  const manifestPath = process.argv[inputIdx + 1];
  const outDir = path.dirname(path.resolve(manifestPath));

  let manifest;
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read manifest: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    console.log('Empty manifest — nothing to do.');
    return;
  }

  console.log(`Screenshotting ${manifest.length} RAS cards...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    const { ras_player_id } = entry;

    const overlay = entry.team_overlay ? ` [${entry.team_overlay}]` : '';
    process.stdout.write(
      `  [${i + 1}/${manifest.length}] PlayerID ${ras_player_id}${overlay}... `
    );

    const ok = await screenshotCard(page, entry, outDir);
    if (ok) {
      succeeded++;
      process.stdout.write('OK\n');
    } else {
      failed++;
      process.stdout.write('FAILED\n');
    }

  }

  await browser.close();
  console.log(`Done: ${succeeded} succeeded, ${failed} failed.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
