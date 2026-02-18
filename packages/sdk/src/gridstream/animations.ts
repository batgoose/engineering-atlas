/**
 * Gridstream CSS animations and base styles.
 * Exact match to v11 prototype's <style> block.
 * Framework-agnostic — inject via <style> tag in any framework.
 */

import { gridstreamColors as C } from './theme';

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

export const GRIDSTREAM_KEYFRAMES = `
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes fadeOut{from{opacity:1}to{opacity:0}}
  @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes rain{0%{transform:translateY(-10px) translateX(0);opacity:0}10%{opacity:.5}90%{opacity:.5}100%{transform:translateY(260px) translateX(var(--drift, 25px));opacity:0}}
  @keyframes snow{0%{transform:translateY(-10px) translateX(0);opacity:0}10%{opacity:.45}90%{opacity:.45}100%{transform:translateY(260px) translateX(var(--drift, 12px));opacity:0}}
  @keyframes scanPulse{0%{opacity:0;transform:translateY(-100%)}50%{opacity:.03}100%{opacity:0;transform:translateY(200%)}}
  @keyframes cornerFlash{0%,90%,100%{opacity:.5}95%{opacity:1}}
  @keyframes possGlow{0%,100%{opacity:.4}50%{opacity:.7}}
  @keyframes ballTravel{0%{offset-distance:0%}100%{offset-distance:100%}}
  @keyframes trailDraw{0%{stroke-dashoffset:1000}100%{stroke-dashoffset:0}}
  @keyframes trailFade{0%{opacity:.6}60%{opacity:.6}100%{opacity:.1}}
  @keyframes catchFlash{0%{r:4;opacity:1}50%{r:16;opacity:.4}100%{r:20;opacity:0}}
  @keyframes turnoverFlash{0%{opacity:0}20%{opacity:.12}100%{opacity:0}}
  @keyframes firstDownPulse{0%{opacity:.6;stroke-width:3}25%{opacity:1;stroke-width:4}50%{opacity:.6;stroke-width:3}75%{opacity:1;stroke-width:4}100%{opacity:.5;stroke-width:2.5}}
  @keyframes firstDownSweep{0%{stroke-dashoffset:20}100%{stroke-dashoffset:0}}
  @keyframes fgMissVeer{0%{offset-distance:0%}60%{offset-distance:70%}100%{offset-distance:100%}}
  @keyframes sparkDraw{0%{stroke-dashoffset:500}100%{stroke-dashoffset:0}}
`;

export const GRIDSTREAM_BASE_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  .hud-panel{position:relative;background:${C.panel};border:1px solid ${C.panelBorder};overflow:hidden}
  .hud-panel::before,.hud-panel::after{content:'';position:absolute;width:14px;height:14px;border-color:${C.cyanDim};border-style:solid;z-index:5;animation:cornerFlash 8s ease infinite}
  .hud-panel::before{top:-1px;left:-1px;border-width:2px 0 0 2px}
  .hud-panel::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
  .hud-label{font-family:'Orbitron',monospace;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:${C.textDim}}
  .tab-btn{font-family:'Orbitron',monospace;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:10px 20px;background:transparent;border:1px solid transparent;border-bottom:none;color:${C.textDim};cursor:pointer;transition:all .15s;position:relative}
  .tab-btn:hover{color:${C.cyanDim}}
  .tab-btn.active{color:${C.cyan};background:${C.panel};border-color:${C.panelBorder}}
  .tab-btn.active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:${C.panel}}
  .play-row{display:flex;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(0,229,255,.03);transition:background .1s;animation:slideUp .25s ease both}
  .play-row:hover{background:rgba(0,229,255,.02)}
  .stat-bar{height:5px;background:rgba(0,229,255,.05);border-radius:1px;overflow:hidden;margin-top:5px}
  .scan-sweep{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
  .scan-sweep::after{content:'';position:absolute;left:0;right:0;height:60px;background:linear-gradient(180deg,transparent,rgba(0,229,255,.02),transparent);animation:scanPulse 6s linear infinite}
  .replay-btn{font-family:'Orbitron',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;padding:4px 12px;background:rgba(255,182,18,.06);border:1px solid ${C.amberBorder};color:${C.amber};cursor:pointer;transition:all .15s;text-transform:uppercase}
  .replay-btn:hover{background:rgba(255,182,18,.12);border-color:${C.amber}}
`;

export function getGridstreamStylesheet(): string {
  return GRIDSTREAM_KEYFRAMES + '\n' + GRIDSTREAM_BASE_STYLES;
}
