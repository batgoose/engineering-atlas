/**
 * Gridstream CSS animations.
 *
 * All @keyframes and timing values as strings that any framework
 * can inject into a <style> tag or CSS-in-JS solution.
 * No React dependency.
 */

// ─── Animation Timing Constants ─────────────────────────────────

export const ANIM_TIMING = {
  pass: 1.2,
  rush: 0.8,
  turnover: 0.6,
  kick: 1.5,
  fieldgoal: 1.8,
  sparkDraw: 1.2,
  catchDelay: 1.1,
  labelDelay: 1.3,
  receiverDelay: 1.5,
  firstDownDelay: 1.3,
} as const;

// ─── Keyframe Definitions ───────────────────────────────────────

export const GRIDSTREAM_KEYFRAMES = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }

  @keyframes ballTravel {
    0%   { offset-distance: 0%; }
    100% { offset-distance: 100%; }
  }

  @keyframes trailDraw {
    0%   { stroke-dashoffset: 1000; }
    100% { stroke-dashoffset: 0; }
  }

  @keyframes trailFade {
    0%   { opacity: 0.5; }
    70%  { opacity: 0.5; }
    100% { opacity: 0.08; }
  }

  @keyframes catchFlash {
    0%   { r: 4; opacity: 0.8; stroke-width: 2; }
    100% { r: 18; opacity: 0; stroke-width: 0.5; }
  }

  @keyframes slideUp {
    0%   { opacity: 0; transform: translateY(6px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  @keyframes turnoverFlash {
    0%   { opacity: 0; }
    20%  { opacity: 0.12; }
    100% { opacity: 0; }
  }

  @keyframes firstDownPulse {
    0%   { opacity: 0.6; stroke-width: 3; }
    25%  { opacity: 1; stroke-width: 4; }
    50%  { opacity: 0.6; stroke-width: 3; }
    75%  { opacity: 1; stroke-width: 4; }
    100% { opacity: 0.5; stroke-width: 2.5; }
  }

  @keyframes firstDownSweep {
    0%   { stroke-dashoffset: 20; }
    100% { stroke-dashoffset: 0; }
  }

  @keyframes sparkDraw {
    0%   { stroke-dashoffset: 500; }
    100% { stroke-dashoffset: 0; }
  }

  @keyframes rain {
    0%   { transform: translateY(-10px) translateX(0); opacity: 0; }
    10%  { opacity: 0.5; }
    90%  { opacity: 0.5; }
    100% { transform: translateY(260px) translateX(var(--drift, 25px)); opacity: 0; }
  }

  @keyframes snow {
    0%   { transform: translateY(-10px) translateX(0); opacity: 0; }
    10%  { opacity: 0.45; }
    90%  { opacity: 0.45; }
    100% { transform: translateY(260px) translateX(var(--drift, 12px)); opacity: 0; }
  }
`;

// ─── HUD Panel Base Styles ──────────────────────────────────────
// Common CSS class definitions used across all HUD panels

export const GRIDSTREAM_BASE_STYLES = `
  .hud-panel {
    background: rgba(7,11,20,.94);
    border: 1px solid rgba(0,229,255,.08);
    backdrop-filter: blur(10px);
  }

  .hud-label {
    font-family: 'Orbitron', monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #5a7a90;
  }

  .play-row {
    display: flex;
    gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid rgba(0,229,255,.03);
    opacity: 0;
    animation: fadeIn 0.3s ease forwards;
  }

  .play-row:hover {
    background: rgba(0,229,255,.02);
  }

  .replay-btn {
    font-family: 'Share Tech Mono', monospace;
    font-size: 12px;
    padding: 4px 14px;
    background: rgba(0,229,255,.04);
    border: 1px solid rgba(0,229,255,.12);
    color: #5a7a90;
    cursor: pointer;
    transition: all 0.15s;
  }

  .replay-btn:hover {
    border-color: #00e5ff;
    color: #00e5ff;
  }
`;

/**
 * Get the full Gridstream stylesheet as a single string.
 * Inject this into a <style> tag in the document head.
 */
export function getGridstreamStylesheet(): string {
  return GRIDSTREAM_KEYFRAMES + '\n' + GRIDSTREAM_BASE_STYLES;
}
