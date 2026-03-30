import { useState, useCallback, useRef, useEffect } from "react";
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";

/* ─────────────────────────────────────────────────────────────────
   API HELPER
──────────────────────────────────────────────────────────────────*/
const BASE = "http://localhost:8000";

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

/* ─────────────────────────────────────────────────────────────────
   STYLES  (injected as a <style> tag — no build tool needed)
──────────────────────────────────────────────────────────────────*/
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --ink:       #1a1d27;
  --ink2:      #22263a;
  --ink3:      #141720;
  --line:      #1e2530;
  --line2:     #252e3c;
  --mist:      #3a4658;
  --fog:       #5a6880;
  --silver:    #8fa3ba;
  --cloud:     #c8d6e3;
  --white:     #eef4fa;
  --teal:      #00c8a8;
  --teal-dim:  rgba(0,200,168,.12);
  --teal-glow: rgba(0,200,168,.28);
  --gold:      #f0a500;
  --red:       #e05050;
  --mono: 'DM Mono', monospace;
  --body: 'DM Sans', sans-serif;
  --disp: 'Syne', sans-serif;
}
html, body, #root { height: 100%; background: var(--ink); color: var(--white); font-family: var(--body); }
button { font-family: var(--body); cursor: pointer; }
input  { font-family: var(--body); }
* { scrollbar-width: thin; scrollbar-color: var(--mist) transparent; }

/* ── page wrapper ── */
.page { min-height: 100vh; display: flex; animation: pg .5s cubic-bezier(.16,1,.3,1) both; }
@keyframes pg { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }

/* ── auth split ── */
.auth-left {
  width: 48%; flex-shrink: 0;
  background: linear-gradient(160deg, #1c2538 0%, #1a2030 100%);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column;
  padding: 44px 52px; position: relative; overflow: hidden;
}
.auth-right {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 48px 40px; background: var(--ink); overflow-y: auto;
}
.mesh {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 60% 50% at 20% 80%, rgba(0,200,168,.06) 0%, transparent 70%),
    radial-gradient(ellipse 50% 40% at 80% 10%, rgba(0,120,180,.06) 0%, transparent 70%);
}
.arch-lines {
  position: absolute; inset: 0; pointer-events: none; opacity: .5;
}

/* ── wordmark ── */
.wm { display: flex; align-items: center; gap: 12px; position: relative; z-index: 2; margin-bottom: 0; }
.wm-icon {
  width: 36px; height: 36px; background: var(--teal); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 24px var(--teal-glow); flex-shrink: 0;
}
.wm-icon svg { width: 20px; height: 20px; }
.wm-name { font-family: var(--disp); font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.wm-badge {
  font-family: var(--mono); font-size: 9px; letter-spacing: .12em; color: var(--teal);
  background: var(--teal-dim); border: 1px solid rgba(0,200,168,.25);
  padding: 2px 8px; border-radius: 20px; margin-left: 4px;
}

/* ── left hero ── */
.left-hero { position: relative; z-index: 2; margin-top: auto; padding-bottom: 32px; }
.eyebrow {
  font-family: var(--mono); font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 14px; display: flex; align-items: center; gap: 10px;
}
.eyebrow::before { content: ''; width: 28px; height: 1px; background: var(--teal); display: block; }
.hero-h { font-family: var(--disp); font-size: 40px; font-weight: 800; line-height: 1.05; letter-spacing: -.04em; margin-bottom: 18px; }
.hero-h em {
  font-style: normal;
  background: linear-gradient(135deg, var(--teal), #00e8c0);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.hero-p { font-size: 14px; line-height: 1.65; color: var(--silver); max-width: 360px; font-weight: 300; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.chip {
  display: flex; align-items: center; gap: 7px;
  background: var(--ink3); border: 1px solid var(--line2);
  border-radius: 6px; padding: 7px 12px; font-size: 12px; color: var(--cloud);
}
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 6px var(--teal-glow); }

/* ── form box ── */
.form-box { width: 100%; max-width: 390px; }
.form-title { font-family: var(--disp); font-size: 28px; font-weight: 800; letter-spacing: -.03em; margin-bottom: 6px; }
.form-sub { font-size: 14px; color: var(--fog); margin-bottom: 28px; line-height: 1.5; }
.form-sub button { background: none; border: none; color: var(--teal); font-size: 14px; font-weight: 500; padding: 0; transition: color .2s; }
.form-sub button:hover { color: #00e8c0; }

/* ── progress dots ── */
.prog { display: flex; gap: 5px; margin-bottom: 24px; }
.dot { width: 6px; height: 6px; background: var(--line2); border-radius: 3px; transition: all .3s; }
.dot.done { background: var(--teal); opacity: .5; }
.dot.active { background: var(--teal); width: 18px; box-shadow: 0 0 8px var(--teal-glow); }

/* ── field ── */
.field { margin-bottom: 14px; position: relative; }
.flabel {
  font-size: 12px; font-weight: 500; color: var(--cloud); margin-bottom: 7px;
  display: flex; justify-content: space-between; align-items: center;
}
.flabel span { font-family: var(--mono); font-size: 10px; color: var(--teal); }
.inp-wrap { position: relative; }
.inp-icon {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  color: var(--fog); pointer-events: none; display: flex; align-items: center;
  transition: color .2s;
}
.inp-wrap:focus-within .inp-icon { color: var(--teal); }
.inp-wrap input {
  width: 100%; background: var(--ink2); border: 1px solid var(--line2);
  border-radius: 8px; color: var(--white); font-size: 14px;
  padding: 12px 14px 12px 42px; outline: none;
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.inp-wrap input::placeholder { color: var(--mist); }
.inp-wrap input:focus {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgba(0,200,168,.14);
  background: rgba(0,200,168,.03);
}
.inp-toggle {
  position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
  font-family: var(--mono); font-size: 11px; color: var(--fog);
  background: none; border: none; cursor: pointer; transition: color .2s; letter-spacing: .04em;
}
.inp-toggle:hover { color: var(--teal); }
.val-msg { font-family: var(--mono); font-size: 10px; margin-top: 5px; letter-spacing: .04em; min-height: 14px; }
.val-ok  { color: var(--teal); }
.val-err { color: var(--red); }

/* ── phone group ── */
.phone-row { display: flex; gap: 8px; }
.cc-inp {
  width: 72px; flex-shrink: 0;
  background: var(--ink2); border: 1px solid var(--line2);
  border-radius: 8px; color: var(--white);
  font-family: var(--mono); font-size: 13px;
  padding: 12px 8px; text-align: center; outline: none;
  transition: border-color .2s;
}
.cc-inp:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(0,200,168,.14); }

/* ── password strength ── */
.str-bars { display: flex; gap: 4px; margin-top: 8px; }
.str-bar { flex: 1; height: 3px; border-radius: 2px; background: var(--line); transition: background .35s; }
.str-weak   { background: var(--red); }
.str-fair   { background: var(--gold); }
.str-good   { background: #6bcb77; }
.str-strong { background: var(--teal); }
.str-lbl { font-family: var(--mono); font-size: 10px; color: var(--fog); margin-top: 5px; letter-spacing: .04em; }

/* ── checkbox ── */
.check-row { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; }
.check-row input[type=checkbox] { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; accent-color: var(--teal); cursor: pointer; }
.check-lbl { font-size: 12px; color: var(--fog); line-height: 1.5; }
.check-lbl a { color: var(--teal); text-decoration: none; }

/* ── buttons ── */
.btn-primary {
  width: 100%; padding: 13px 20px;
  background: var(--teal); color: var(--ink); border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 20px;
  position: relative; overflow: hidden;
  transition: background .2s, box-shadow .2s, transform .15s;
  letter-spacing: .01em;
}
.btn-primary:hover:not(:disabled) { background: #00ddb8; box-shadow: 0 4px 28px var(--teal-glow); transform: translateY(-1px); }
.btn-primary:active { transform: translateY(0); }
.btn-primary:disabled { opacity: .6; cursor: not-allowed; }
.btn-ghost {
  width: 100%; padding: 12px 20px; margin-top: 10px;
  background: transparent; color: var(--silver);
  border: 1px solid var(--line2); border-radius: 8px;
  font-size: 14px; font-weight: 500;
  transition: border-color .2s, color .2s;
}
.btn-ghost:hover { border-color: var(--mist); color: var(--white); }

/* ── error banner ── */
.err-box {
  background: rgba(224,80,80,.08); border: 1px solid rgba(224,80,80,.3);
  border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;
  font-size: 12px; color: #e8a0a0; line-height: 1.6;
}

/* ── OTP boxes ── */
.otp-row { display: flex; gap: 8px; justify-content: center; margin: 24px 0 8px; }
.otp-box {
  width: 48px; height: 56px; background: var(--ink2);
  border: 1px solid var(--line2); border-radius: 8px; text-align: center;
  font-family: var(--mono); font-size: 22px; font-weight: 500; color: var(--teal);
  outline: none; transition: border-color .2s, box-shadow .2s;
}
.otp-box:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(0,200,168,.15); }
.otp-box.filled { border-color: rgba(0,200,168,.4); background: rgba(0,200,168,.05); }
.otp-hint { text-align: center; font-size: 13px; color: var(--fog); }
.otp-timer { display: block; text-align: center; font-family: var(--mono); font-size: 11px; color: var(--gold); margin-top: 8px; letter-spacing: .06em; }
.otp-resend { display: block; text-align: center; font-size: 12px; color: var(--teal); cursor: pointer; margin-top: 10px; font-weight: 500; background: none; border: none; }

/* ── or divider ── */
.or-div {
  display: flex; align-items: center; gap: 14px; margin: 20px 0;
  font-size: 12px; color: var(--mist); font-family: var(--mono); letter-spacing: .08em;
}
.or-div::before, .or-div::after { content: ''; flex: 1; height: 1px; background: var(--line); }

/* ── nav bar ── */
.nav {
  height: 64px; background: var(--ink2); border-bottom: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; flex-shrink: 0; position: sticky; top: 0; z-index: 50;
}
.nav-left  { display: flex; align-items: center; gap: 14px; }
.nav-right { display: flex; align-items: center; gap: 16px; }
.nav-divider { width: 1px; height: 20px; background: var(--line2); }
.nav-section { font-family: var(--mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mist); }
.nav-section.teal { color: var(--teal); }
.nav-account {
  display: flex; align-items: center; gap: 10px;
  background: var(--ink3); border: 1px solid var(--line2);
  border-radius: 8px; padding: 7px 14px;
}
.nav-avatar {
  width: 26px; height: 26px; border-radius: 50%;
  background: linear-gradient(135deg, var(--teal), #0080cc);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: var(--ink); font-family: var(--mono);
}
.nav-uname { font-size: 13px; font-weight: 500; }
.nav-signout {
  font-family: var(--mono); font-size: 11px; color: var(--fog);
  background: none; border: none; letter-spacing: .06em; padding: 4px 8px;
  border-radius: 5px; transition: color .2s;
}
.nav-signout:hover { color: var(--red); }

/* ── dashboard ── */
.dash-page { flex-direction: column; }
.dash-body { flex: 1; padding: 48px 64px; overflow-y: auto; }
.greeting-eyebrow {
  font-family: var(--mono); font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
}
.greeting-eyebrow::before { content: ''; width: 20px; height: 1px; background: var(--teal); }
.greeting-h { font-family: var(--disp); font-size: 36px; font-weight: 800; letter-spacing: -.04em; line-height: 1.1; }
.greeting-h span { background: linear-gradient(135deg, var(--teal), #00e8c0); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.greeting-sub { font-size: 14px; color: var(--fog); margin-top: 8px; line-height: 1.6; }
.section-lbl {
  font-family: var(--mono); font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--mist); margin: 40px 0 20px; display: flex; align-items: center; gap: 12px;
}
.section-lbl::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.lang-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.lang-card {
  background: var(--ink2); border: 1px solid var(--line2); border-radius: 14px;
  padding: 28px 24px; cursor: pointer; position: relative; overflow: hidden;
  transition: border-color .25s, transform .2s, box-shadow .25s;
  animation: cardIn .5s cubic-bezier(.16,1,.3,1) both;
}
@keyframes cardIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
.lang-card::before {
  content: ''; position: absolute; inset: 0; border-radius: 14px;
  background: radial-gradient(circle at 50% 0%, rgba(0,200,168,.08) 0%, transparent 60%);
  opacity: 0; transition: opacity .3s;
}
.lang-card:hover:not(.disabled) { border-color: var(--teal); transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,200,168,.12); }
.lang-card:hover:not(.disabled)::before { opacity: 1; }
.lang-card.disabled { opacity: .45; cursor: not-allowed; }
.card-badge {
  position: absolute; top: 16px; right: 16px;
  font-family: var(--mono); font-size: 9px; letter-spacing: .1em;
  color: var(--teal); background: var(--teal-dim);
  border: 1px solid rgba(0,200,168,.2); padding: 2px 7px; border-radius: 20px;
}
.card-badge.soon { color: var(--fog); background: transparent; border-color: var(--line2); }
.card-icon {
  width: 48px; height: 48px; border-radius: 10px;
  background: var(--teal-dim); border: 1px solid rgba(0,200,168,.2);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 15px; font-weight: 500; color: var(--teal);
  margin-bottom: 18px;
}
.card-icon.dim { background: var(--ink3); border-color: var(--line2); color: var(--fog); }
.card-name { font-family: var(--disp); font-size: 18px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 6px; }
.card-desc { font-size: 12px; color: var(--fog); line-height: 1.55; }
.card-arrow { position: absolute; right: 20px; bottom: 20px; font-size: 16px; color: var(--mist); transition: color .2s, transform .2s; }
.lang-card:hover:not(.disabled) .card-arrow { color: var(--teal); transform: translate(3px,-3px); }

/* ── editor page ── */
.editor-page { flex-direction: column; }
.editor-body {
  flex: 1; display: grid; grid-template-columns: 1fr 1fr;
  overflow: hidden; height: calc(100vh - 64px);
}
.editor-panel { display: flex; flex-direction: column; border-right: 1px solid var(--line); overflow: hidden; }
.panel-hdr {
  padding: 14px 20px; border-bottom: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0; background: var(--ink2);
}
.panel-title { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--silver); }
.ptitle-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 8px var(--teal-glow); }
.panel-actions { display: flex; gap: 8px; }
.panel-btn {
  font-family: var(--mono); font-size: 10px; letter-spacing: .08em;
  color: var(--fog); background: var(--ink3); border: 1px solid var(--line2);
  border-radius: 5px; padding: 5px 10px; transition: color .2s, border-color .2s;
}
.panel-btn:hover { color: var(--white); border-color: var(--mist); }

/* ── code editor ── */
.editor-wrap { flex: 1; position: relative; overflow: hidden; background: var(--ink); }
.line-nums {
  position: absolute; left: 0; top: 0; bottom: 0; width: 44px;
  display: flex; flex-direction: column; padding: 20px 0; overflow: hidden;
  border-right: 1px solid var(--line); background: var(--ink2); pointer-events: none;
}
.line-num { font-family: var(--mono); font-size: 11px; color: var(--mist); text-align: right; padding-right: 10px; line-height: 1.7; min-height: 22.1px; flex-shrink: 0; }
.code-ta {
  width: 100%; height: 100%; background: transparent; border: none; outline: none;
  color: #a8d8b8; font-family: var(--mono); font-size: 13px; line-height: 1.7;
  padding: 20px 20px 20px 56px; resize: none; overflow-y: auto;
  tab-size: 4; caret-color: var(--teal);
}
.code-ta::placeholder { color: var(--mist); }

/* ── run bar ── */
.run-bar {
  padding: 12px 20px; border-top: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0; background: var(--ink2);
}
.run-info { font-family: var(--mono); font-size: 10px; color: var(--mist); letter-spacing: .06em; }
.run-info span { color: var(--teal); }
.btn-run {
  display: flex; align-items: center; gap: 8px;
  background: var(--teal); color: var(--ink); border: none; border-radius: 7px;
  font-size: 13px; font-weight: 600; padding: 10px 20px;
  transition: background .2s, box-shadow .2s, transform .15s;
}
.btn-run:hover:not(:disabled) { background: #00ddb8; box-shadow: 0 4px 24px var(--teal-glow); transform: translateY(-1px); }
.btn-run:disabled { opacity: .6; cursor: not-allowed; }
.btn-run svg { width: 13px; height: 13px; }

/* ── output panel ── */
.output-panel { display: flex; flex-direction: column; overflow: hidden; }
.out-tabs {
  display: flex; gap: 2px; padding: 10px 14px 0;
  border-bottom: 1px solid var(--line); flex-shrink: 0; background: var(--ink2);
}
.out-tab {
  font-family: var(--mono); font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--mist); padding: 7px 12px; border-radius: 5px 5px 0 0;
  background: none; border: none; border-bottom: 2px solid transparent;
  position: relative; top: 1px; transition: color .2s;
}
.out-tab:hover { color: var(--silver); }
.out-tab.active { color: var(--teal); border-bottom-color: var(--teal); background: var(--ink); }
.out-content { flex: 1; overflow-y: auto; padding: 20px; }

/* ── empty / loading / result ── */
.out-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; }
.out-empty-icon { width: 56px; height: 56px; border-radius: 14px; background: var(--ink3); border: 1px solid var(--line2); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 20px; }
.out-empty-h { font-family: var(--disp); font-size: 18px; font-weight: 800; color: var(--cloud); margin-bottom: 8px; }
.out-empty-p { font-size: 13px; color: var(--fog); line-height: 1.6; max-width: 260px; }
.out-loading { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.loader { width: 36px; height: 36px; border: 2px solid var(--line2); border-top-color: var(--teal); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.loader-msg { font-family: var(--mono); font-size: 11px; color: var(--fog); letter-spacing: .1em; }

/* ── flow diagram ── */
.flow-wrap { width: 100%; height: 500px; background: var(--ink3); border: 1px solid var(--line2); border-radius: 10px; overflow: hidden; }
.stats-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.stat-pill {
  font-family: var(--mono); font-size: 10px; letter-spacing: .08em;
  color: var(--teal); background: var(--teal-dim);
  border: 1px solid rgba(0,200,168,.2); padding: 4px 10px; border-radius: 20px;
}

/* ── explanation ── */
.expl-card { background: var(--ink2); border: 1px solid var(--line2); border-radius: 10px; padding: 18px 20px; font-size: 13px; color: var(--silver); line-height: 1.7; white-space: pre-wrap; }

/* ── section label ── */
.sect-lbl {
  font-family: var(--mono); font-size: 9px; letter-spacing: .2em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
}
.sect-lbl::after { content:''; flex:1; height:1px; background: rgba(0,200,168,.2); }

/* ── toast ── */
.toast {
  position: fixed; bottom: 28px; left: 50%;
  transform: translateX(-50%) translateY(80px);
  background: var(--ink2); border: 1px solid var(--line2);
  border-radius: 10px; padding: 12px 20px;
  display: flex; align-items: center; gap: 12px;
  font-size: 13px; color: var(--cloud); z-index: 999; opacity: 0;
  transition: transform .4s cubic-bezier(.16,1,.3,1), opacity .35s;
  white-space: nowrap; box-shadow: 0 8px 32px rgba(0,0,0,.4); min-width: 240px; pointer-events: none;
}
.toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
.toast.ok  { border-color: rgba(0,200,168,.3); }
.toast.err { border-color: rgba(224,80,80,.3); }
.toast-icon { font-size: 16px; }

@media (max-width:860px) {
  .auth-left { display: none; }
  .auth-right { justify-content: flex-start; padding-top: 80px; }
  .editor-body { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .dash-body { padding: 24px 20px; }
}
`;

/* ─────────────────────────────────────────────────────────────────
   TOAST
──────────────────────────────────────────────────────────────────*/
function Toast({ msg, type, show }) {
  return (
    <div className={`toast ${type} ${show ? "show" : ""}`}>
      <span className="toast-icon">{type === "ok" ? "✓" : "✕"}</span>
      <span>{msg}</span>
    </div>
  );
}

function useToast() {
  const [t, setT] = useState({ msg: "", type: "ok", show: false });
  const timerRef = useRef(null);
  const fire = useCallback((type, msg) => {
    clearTimeout(timerRef.current);
    setT({ msg, type, show: true });
    timerRef.current = setTimeout(() => setT(p => ({ ...p, show: false })), 3200);
  }, []);
  return [t, fire];
}

/* ─────────────────────────────────────────────────────────────────
   ICONS
──────────────────────────────────────────────────────────────────*/
const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconPhone = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/>
  </svg>
);
const IconLock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);
const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);
const RagsyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6h6M4 10h4M4 14h8M14 4l6 8-6 8" stroke="#0A0C10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ─────────────────────────────────────────────────────────────────
   WORDMARK
──────────────────────────────────────────────────────────────────*/
function Wordmark() {
  return (
    <div className="wm">
      <div className="wm-icon"><RagsyIcon /></div>
      <span className="wm-name">Ragsy</span>
      <span className="wm-badge">BETA</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   NAV BAR
──────────────────────────────────────────────────────────────────*/
function NavBar({ user, section, tealSection, onLogoClick, onSignOut }) {
  return (
    <nav className="nav">
      <div className="nav-left">
        <div style={{ cursor: "pointer" }} onClick={onLogoClick}>
          <div className="wm" style={{ gap: 10 }}>
            <div className="wm-icon" style={{ width: 30, height: 30, borderRadius: 7 }}><RagsyIcon /></div>
            <span className="wm-name" style={{ fontSize: 18 }}>Ragsy</span>
          </div>
        </div>
        <div className="nav-divider" />
        <span className={`nav-section${tealSection ? " teal" : ""}`}>{section}</span>
      </div>
      <div className="nav-right">
        {user && (
          <div className="nav-account">
            <div className="nav-avatar">{user.username.slice(0, 2).toUpperCase()}</div>
            <span className="nav-uname">{user.username}</span>
          </div>
        )}
        <button className="nav-signout" onClick={onSignOut}>Sign out</button>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────
   REGISTER  (3 steps: info → password → OTP verify)
──────────────────────────────────────────────────────────────────*/
function RegisterView({ onSwitch, onSuccess, toast }) {
  const [step, setStep]           = useState(1);
  const [username, setUsername]   = useState("");
  const [cc, setCc]               = useState("+91");
  const [phone, setPhone]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPass, setShowPass]   = useState(false);
  const [agreed, setAgreed]       = useState(false);
  const [otp, setOtp]             = useState(["","","","","",""]);
  const [timerSecs, setTimerSecs] = useState(300);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [mobileNo, setMobileNo]   = useState("");
  const [devOtp, setDevOtp]       = useState("");
  const timerRef = useRef(null);
  const otpRefs  = useRef([]);

  const strength = (() => {
    let s = 0;
    if (password.length >= 6) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();
  const strClass = ["","str-weak","str-fair","str-good","str-strong"][strength];
  const strLabel = ["Enter a password","Weak","Fair","Good","Strong ✓"][strength];

  function startTimer(secs = 300) {
    clearInterval(timerRef.current);
    setTimerSecs(secs);
    timerRef.current = setInterval(() => {
      setTimerSecs(p => { if (p <= 1) { clearInterval(timerRef.current); return 0; } return p - 1; });
    }, 1000);
  }
  useEffect(() => () => clearInterval(timerRef.current), []);

  const timerDisplay = `${String(Math.floor(timerSecs / 60)).padStart(2,"0")}:${String(timerSecs % 60).padStart(2,"0")}`;

  // Step 1 → Step 2
  async function handleStep1(e) {
    e.preventDefault();
    setError("");
    if (!username.trim()) return setError("Username is required");
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return setError("3–20 chars: lowercase, digits, underscores only");
    if (!phone.trim()) return setError("Mobile number is required");
    setStep(2);
  }

  // Step 2 → register → OTP step
  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (!agreed) return setError("Please agree to the Terms of Service");
    const fullMobile = cc + phone.replace(/\s/g, "");
    setLoading(true);
    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), mobile_no: fullMobile, password }),
      });
      setMobileNo(fullMobile);
      setDevOtp(data.otp_code || "");   // shown in dev mode
      startTimer(data.expires_in || 300);
      setStep(3);
      toast("ok", "OTP sent to your mobile!");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // OTP input handling
  function handleOtpInput(val, idx) {
    const d = val.replace(/\D/g, "").slice(0, 1);
    const next = [...otp]; next[idx] = d; setOtp(next);
    if (d && idx < 5) otpRefs.current[idx + 1]?.focus();
  }
  function handleOtpKey(e, idx) {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  }

  // Verify OTP
  async function handleVerify(e) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) return setError("Enter the complete 6-digit code");
    setLoading(true); setError("");
    try {
      const data = await apiFetch("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ mobile_no: mobileNo, otp_code: code }),
      });
      toast("ok", "Mobile verified! Welcome to Ragsy 🎉");
      onSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Resend OTP
  async function handleResend() {
    try {
      const data = await apiFetch("/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ mobile_no: mobileNo }),
      });
      setDevOtp(data.otp_code || "");
      startTimer(data.expires_in || 300);
      setOtp(["","","","","",""]);
      toast("ok", "New OTP sent!");
    } catch (err) {
      setError(err.message);
    }
  }

  const dots = [1, 2, 3].map(n => (
    <div key={n} className={`dot ${n < step ? "done" : n === step ? "active" : ""}`} />
  ));

  return (
    <div className="form-box">
      <div className="form-title">Create your account</div>
      <p className="form-sub">Already have one? <button onClick={() => onSwitch("login")}>Sign in →</button></p>
      <div className="prog">{dots}</div>

      {error && <div className="err-box">{error}</div>}

      {/* STEP 1 — username + phone */}
      {step === 1 && (
        <form onSubmit={handleStep1}>
          <div className="field">
            <div className="flabel">Username</div>
            <div className="inp-wrap">
              <span className="inp-icon"><IconUser /></span>
              <input value={username} onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="e.g. alex_dev" autoComplete="username" />
            </div>
            {username && (
              <div className={`val-msg ${/^[a-z0-9_]{3,20}$/.test(username) ? "val-ok" : "val-err"}`}>
                {/^[a-z0-9_]{3,20}$/.test(username) ? "✓ Looks good" : "✕ 3–20 chars: lowercase, digits, underscores"}
              </div>
            )}
          </div>
          <div className="field">
            <div className="flabel">Mobile Number <span>FOR OTP</span></div>
            <div className="phone-row">
              <input className="cc-inp" value={cc} onChange={e => setCc(e.target.value)} placeholder="+91" />
              <div className="inp-wrap" style={{ flex: 1 }}>
                <span className="inp-icon"><IconPhone /></span>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" />
              </div>
            </div>
          </div>
          <button className="btn-primary" type="submit">Continue →</button>
        </form>
      )}

      {/* STEP 2 — password */}
      {step === 2 && (
        <form onSubmit={handleRegister}>
          <div className="field">
            <div className="flabel">Password</div>
            <div className="inp-wrap">
              <span className="inp-icon"><IconLock /></span>
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
              <button type="button" className="inp-toggle" onClick={() => setShowPass(p => !p)}>{showPass ? "hide" : "show"}</button>
            </div>
            <div className="str-bars">
              {[0,1,2,3].map(i => <div key={i} className={`str-bar ${i < strength ? strClass : ""}`} />)}
            </div>
            <div className="str-lbl" style={{ color: strength === 4 ? "var(--teal)" : strength === 3 ? "#6bcb77" : strength === 2 ? "var(--gold)" : "var(--red)" }}>{strLabel}</div>
          </div>
          <div className="check-row">
            <input type="checkbox" id="tos" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <label className="check-lbl" htmlFor="tos">I agree to Ragsy's <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.</label>
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? "Creating…" : "Create Account"}</button>
          <button type="button" className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
        </form>
      )}

      {/* STEP 3 — OTP verify */}
      {step === 3 && (
        <form onSubmit={handleVerify}>
          <p className="otp-hint">Enter the 6-digit code sent to<br /><strong style={{ color: "var(--white)" }}>{mobileNo}</strong></p>
          {devOtp && (
            <div style={{ textAlign: "center", marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--gold)", background: "rgba(240,165,0,.08)", border: "1px solid rgba(240,165,0,.25)", borderRadius: 6, padding: "6px 12px" }}>
              DEV OTP: <strong>{devOtp}</strong>
            </div>
          )}
          <div className="otp-row">
            {otp.map((v, i) => (
              <input key={i} ref={el => otpRefs.current[i] = el}
                className={`otp-box ${v ? "filled" : ""}`}
                type="text" maxLength={1} inputMode="numeric"
                value={v} onChange={e => handleOtpInput(e.target.value, i)}
                onKeyDown={e => handleOtpKey(e, i)} />
            ))}
          </div>
          <span className="otp-timer">{timerSecs > 0 ? `Expires in ${timerDisplay}` : "Code expired"}</span>
          <button type="button" className="otp-resend" onClick={handleResend}>Didn't receive it? Resend code</button>
          <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 20 }}>{loading ? "Verifying…" : "Verify & Continue →"}</button>
        </form>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LOGIN
──────────────────────────────────────────────────────────────────*/
function LoginView({ onSwitch, onSuccess, toast }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    if (!username || !password) return setError("Please fill in all fields");
    setLoading(true);
    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      toast("ok", `Welcome back, ${data.user.username}!`);
      onSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form-box">
      <div className="form-title">Welcome back</div>
      <p className="form-sub">New to Ragsy? <button onClick={() => onSwitch("register")}>Create a free account →</button></p>

      {error && <div className="err-box">{error}</div>}

      <form onSubmit={handleLogin}>
        <div className="field">
          <div className="flabel">Username</div>
          <div className="inp-wrap">
            <span className="inp-icon"><IconUser /></span>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="your_handle" autoComplete="username" />
          </div>
        </div>
        <div className="field">
          <div className="flabel">Password</div>
          <div className="inp-wrap">
            <span className="inp-icon"><IconLock /></span>
            <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            <button type="button" className="inp-toggle" onClick={() => setShowPass(p => !p)}>{showPass ? "hide" : "show"}</button>
          </div>
        </div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign In →"}</button>
      </form>

      <div className="or-div">or</div>
      <button className="btn-ghost" onClick={() => onSwitch("otp-login")}>📱 Sign in with OTP</button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   OTP LOGIN  (phone → send OTP → verify → login)
   Note: backend has no dedicated "otp login" route.
   We use register flow but allow already-registered users to re-verify.
   In practice: user enters mobile → get resend-otp → verify → we fetch /auth/me
──────────────────────────────────────────────────────────────────*/
function OtpLoginView({ onSwitch, onSuccess, toast }) {
  const [phase, setPhase]       = useState(1);
  const [cc, setCc]             = useState("+91");
  const [phone, setPhone]       = useState("");
  const [otp, setOtp]           = useState(["","","","","",""]);
  const [timerSecs, setTimerSecs] = useState(300);
  const [mobileNo, setMobileNo] = useState("");
  const [devOtp, setDevOtp]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const timerRef = useRef(null);
  const otpRefs  = useRef([]);

  function startTimer(secs = 300) {
    clearInterval(timerRef.current);
    setTimerSecs(secs);
    timerRef.current = setInterval(() => {
      setTimerSecs(p => { if (p <= 1) { clearInterval(timerRef.current); return 0; } return p - 1; });
    }, 1000);
  }
  useEffect(() => () => clearInterval(timerRef.current), []);
  const timerDisplay = `${String(Math.floor(timerSecs / 60)).padStart(2,"0")}:${String(timerSecs % 60).padStart(2,"0")}`;

  async function handleSend(e) {
    e.preventDefault();
    setError("");
    const full = cc + phone.replace(/\s/g, "");
    setLoading(true);
    try {
      const data = await apiFetch("/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ mobile_no: full }),
      });
      setMobileNo(full);
      setDevOtp(data.otp_code || "");
      startTimer(data.expires_in || 300);
      setPhase(2);
      toast("ok", "OTP sent!");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpInput(val, idx) {
    const d = val.replace(/\D/g, "").slice(0, 1);
    const next = [...otp]; next[idx] = d; setOtp(next);
    if (d && idx < 5) otpRefs.current[idx + 1]?.focus();
  }
  function handleOtpKey(e, idx) {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  }

  async function handleVerify(e) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) return setError("Enter the complete 6-digit code");
    setLoading(true); setError("");
    try {
      const data = await apiFetch("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ mobile_no: mobileNo, otp_code: code }),
      });
      toast("ok", `Welcome, ${data.user.username}!`);
      onSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form-box">
      <div className="form-title">OTP Sign In</div>
      <p className="form-sub">Already have an account? <button onClick={() => onSwitch("login")}>Sign in with password →</button></p>

      {error && <div className="err-box">{error}</div>}

      {phase === 1 && (
        <form onSubmit={handleSend}>
          <div className="field">
            <div className="flabel">Registered Mobile Number</div>
            <div className="phone-row">
              <input className="cc-inp" value={cc} onChange={e => setCc(e.target.value)} placeholder="+91" />
              <div className="inp-wrap" style={{ flex: 1 }}>
                <span className="inp-icon"><IconPhone /></span>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" />
              </div>
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? "Sending…" : "Send OTP →"}</button>
          <button type="button" className="btn-ghost" onClick={() => onSwitch("login")}>← Back to Sign In</button>
        </form>
      )}

      {phase === 2 && (
        <form onSubmit={handleVerify}>
          <p className="otp-hint">Code sent to <strong style={{ color: "var(--white)" }}>{mobileNo}</strong></p>
          {devOtp && (
            <div style={{ textAlign: "center", marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--gold)", background: "rgba(240,165,0,.08)", border: "1px solid rgba(240,165,0,.25)", borderRadius: 6, padding: "6px 12px" }}>
              DEV OTP: <strong>{devOtp}</strong>
            </div>
          )}
          <div className="otp-row">
            {otp.map((v, i) => (
              <input key={i} ref={el => otpRefs.current[i] = el}
                className={`otp-box ${v ? "filled" : ""}`}
                type="text" maxLength={1} inputMode="numeric"
                value={v} onChange={e => handleOtpInput(e.target.value, i)}
                onKeyDown={e => handleOtpKey(e, i)} />
            ))}
          </div>
          <span className="otp-timer">{timerSecs > 0 ? `Expires in ${timerDisplay}` : "Code expired"}</span>
          <button type="button" className="otp-resend" onClick={handleSend}>Resend code</button>
          <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 20 }}>{loading ? "Verifying…" : "Verify & Sign In →"}</button>
          <button type="button" className="btn-ghost" onClick={() => setPhase(1)}>← Change number</button>
        </form>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   AUTH PAGE
──────────────────────────────────────────────────────────────────*/
function AuthPage({ onAuth }) {
  const [view, setView] = useState("register");
  const [toast, fireToast] = useToast();

  function handleSuccess(token, user) {
    localStorage.setItem("ragsy_token", token);
    localStorage.setItem("ragsy_user", JSON.stringify(user));
    onAuth(token, user);
  }

  return (
    <div className="page">
      <style>{STYLES}</style>
      <Toast {...toast} />

      {/* LEFT */}
      <div className="auth-left">
        <div className="mesh" />
        <svg className="arch-lines" viewBox="0 0 700 480" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="140" y1="120" x2="350" y2="200" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
          <line x1="350" y1="200" x2="560" y2="140" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
          <line x1="350" y1="200" x2="350" y2="340" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
          <line x1="350" y1="340" x2="180" y2="420" stroke="#00C8A8" strokeWidth="1" opacity=".12"/>
          <line x1="350" y1="340" x2="520" y2="420" stroke="#00C8A8" strokeWidth="1" opacity=".12"/>
          <circle r="3" fill="#00C8A8" opacity=".6">
            <animateMotion dur="4s" repeatCount="indefinite" path="M140,120 L350,200"/>
            <animate attributeName="opacity" values=".6;0;.6" dur="4s" repeatCount="indefinite"/>
          </circle>
          <circle r="3" fill="#00C8A8" opacity=".6">
            <animateMotion dur="3.5s" repeatCount="indefinite" begin="1s" path="M350,200 L560,140"/>
            <animate attributeName="opacity" values=".6;0;.6" dur="3.5s" repeatCount="indefinite" begin="1s"/>
          </circle>
          <g opacity=".25">
            <rect x="300" y="174" width="100" height="52" rx="6" fill="#00C8A8" fillOpacity=".15" stroke="#00C8A8" strokeWidth="1.2"/>
            <text x="350" y="203" textAnchor="middle" fill="#00C8A8" fontSize="11" fontFamily="DM Mono,monospace">USERS</text>
            <rect x="76" y="96" width="128" height="48" rx="5" fill="#0080CC" fillOpacity=".08" stroke="#3A5068" strokeWidth="1"/>
            <text x="140" y="124" textAnchor="middle" fill="#6BA8D0" fontSize="9" fontFamily="DM Mono,monospace">OTP_VERIFY</text>
            <rect x="506" y="114" width="120" height="48" rx="5" fill="#0080CC" fillOpacity=".08" stroke="#3A5068" strokeWidth="1"/>
            <text x="566" y="142" textAnchor="middle" fill="#6BA8D0" fontSize="9" fontFamily="DM Mono,monospace">FLOWCHARTS</text>
            <rect x="462" y="396" width="118" height="44" rx="5" fill="#0080CC" fillOpacity=".08" stroke="#3A5068" strokeWidth="1"/>
            <text x="521" y="422" textAnchor="middle" fill="#6BA8D0" fontSize="9" fontFamily="DM Mono,monospace">CODE_SUBMISSIONS</text>
          </g>
        </svg>

        <Wordmark />
        <div className="left-hero">
          <div className="eyebrow">Code to Architecture</div>
          <h1 className="hero-h">Turn your<br />code into<br /><em>living diagrams.</em></h1>
          <p className="hero-p">Paste any Python code and Ragsy automatically generates interactive flowcharts and detailed explanations — instantly.</p>
          <div className="chips">
            <div className="chip"><div className="chip-dot" />Interactive flowcharts</div>
            <div className="chip"><div className="chip-dot" />Mobile OTP auth</div>
            <div className="chip"><div className="chip-dot" />AST-powered</div>
            <div className="chip"><div className="chip-dot" />Export ready</div>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="auth-right">
        {view === "register"  && <RegisterView  onSwitch={setView} onSuccess={handleSuccess} toast={fireToast} />}
        {view === "login"     && <LoginView     onSwitch={setView} onSuccess={handleSuccess} toast={fireToast} />}
        {view === "otp-login" && <OtpLoginView  onSwitch={setView} onSuccess={handleSuccess} toast={fireToast} />}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD
──────────────────────────────────────────────────────────────────*/
function DashboardPage({ user, onNavigate, onSignOut }) {
  return (
    <div className="page dash-page">
      <style>{STYLES}</style>
      <NavBar user={user} section="Dashboard" onLogoClick={() => {}} onSignOut={onSignOut} />
      <div className="dash-body">
        <div className="greeting-eyebrow">Welcome back</div>
        <h1 className="greeting-h">Hello, <span>{user.username}</span> 👋</h1>
        <p className="greeting-sub">Choose a language below to start visualizing your code architecture.</p>

        <div className="section-lbl">Available Languages</div>
        <div className="lang-grid">
          <div className="lang-card" onClick={() => onNavigate("editor")} style={{ animationDelay: "0s" }}>
            <div className="card-badge">ACTIVE</div>
            <div className="card-icon">Py</div>
            <div className="card-name">Python</div>
            <div className="card-desc">Visualize functions, classes, loops, conditionals and control flow from your Python source code.</div>
            <div className="card-arrow">↗</div>
          </div>
          {[["C", "C Language", "Structs, pointers, memory flow and function call graphs."],
            ["C++", "C++ Language", "Class hierarchies, templates and object-oriented architecture."],
            ["JS", "JavaScript", "Module graphs, async flow and component trees."]].map(([icon, name, desc], i) => (
            <div className="lang-card disabled" key={icon} style={{ animationDelay: `${(i+1)*.08}s` }}>
              <div className="card-badge soon">SOON</div>
              <div className="card-icon dim">{icon}</div>
              <div className="card-name">{name}</div>
              <div className="card-desc">{desc}</div>
              <div className="card-arrow" style={{ color: "var(--line2)" }}>↗</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   REACT FLOW DIAGRAM
──────────────────────────────────────────────────────────────────*/
function FlowDiagram({ nodes: initNodes, edges: initEdges }) {
  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);
  return (
    <div className="flow-wrap">
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        fitView fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1} maxZoom={2}
      >
        <Background color="#1e2530" gap={20} />
        <Controls style={{ background: "var(--ink2)", border: "1px solid var(--line2)" }} />
        <MiniMap style={{ background: "var(--ink3)" }} nodeColor={n => n.style?.border?.split("solid ")[1] || "#3a4658"} />
      </ReactFlow>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   EDITOR PAGE
──────────────────────────────────────────────────────────────────*/
const SAMPLE = `import math

class Circle:
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return math.pi * self.radius ** 2

    def perimeter(self):
        return 2 * math.pi * self.radius

def compare_shapes(shapes):
    results = []
    for shape in shapes:
        if isinstance(shape, Circle):
            results.append(shape.area())
        else:
            results.append(0)
    return results

shapes = [Circle(3), Circle(5), Circle(7)]
areas = compare_shapes(shapes)
print("Areas:", areas)
`;

function EditorPage({ user, token, onBack, onSignOut }) {
  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [activeTab, setTab]   = useState("diagram");
  const [error, setError]     = useState("");
  const [toast, fireToast]    = useToast();
  const taRef = useRef(null);

  const lineCount = code.split("\n").length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

  function syncScroll(e) {
    const lineNums = e.target.previousSibling;
    if (lineNums) lineNums.scrollTop = e.target.scrollTop;
  }

  async function handleRun() {
    if (!code.trim()) return fireToast("err", "Please paste some Python code first");
    setLoading(true); setResult(null); setError("");
    try {
      const data = await apiFetch(`/visualize?token=${token}`, {
        method: "POST",
        body: JSON.stringify({ code, language: "python" }),
      });
      setResult(data);
      setTab("diagram");
      fireToast("ok", `Architecture generated! ${data.stats.node_count} nodes`);
    } catch (err) {
      setError(err.message);
      fireToast("err", err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page editor-page">
      <style>{STYLES}</style>
      <Toast {...toast} />
      <NavBar user={user} section="Python" tealSection onLogoClick={onBack} onSignOut={onSignOut} />

      <div className="editor-body">
        {/* INPUT PANEL */}
        <div className="editor-panel">
          <div className="panel-hdr">
            <div className="panel-title">
              <div className="ptitle-dot" />
              Python Source Code
            </div>
            <div className="panel-actions">
              <button className="panel-btn" onClick={() => { setCode(SAMPLE); }}>Load Sample</button>
              <button className="panel-btn" onClick={() => { setCode(""); setResult(null); setError(""); }}>Clear</button>
            </div>
          </div>

          <div className="editor-wrap">
            <div className="line-nums" style={{ overflowY: "hidden" }}>
              {lines.map(n => <div key={n} className="line-num">{n}</div>)}
            </div>
            <textarea
              ref={taRef}
              className="code-ta"
              value={code}
              onChange={e => setCode(e.target.value)}
              onScroll={syncScroll}
              placeholder={"# Paste your Python code here...\n# Or click 'Load Sample' to try an example"}
              spellCheck={false}
            />
          </div>

          <div className="run-bar">
            <div className="run-info">Language: <span>Python</span> · AST-powered</div>
            <button className="btn-run" onClick={handleRun} disabled={loading}>
              {loading
                ? <><div className="loader" style={{ width: 14, height: 14 }} /> Analyzing…</>
                : <><IconPlay /> Generate Flowchart</>
              }
            </button>
          </div>
        </div>

        {/* OUTPUT PANEL */}
        <div className="output-panel">
          {result && (
            <div className="out-tabs">
              {["diagram", "explanation", "stats"].map(t => (
                <button key={t} className={`out-tab ${activeTab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}

          {!result && (
            <div className="panel-hdr">
              <div className="panel-title">
                <div className="ptitle-dot" style={{ background: "var(--fog)", boxShadow: "none" }} />
                Flowchart Output
              </div>
            </div>
          )}

          <div className="out-content">
            {!result && !loading && !error && (
              <div className="out-empty">
                <div className="out-empty-icon">⬡</div>
                <div className="out-empty-h">No code yet</div>
                <p className="out-empty-p">Paste Python source on the left and click "Generate Flowchart" to visualize it.</p>
              </div>
            )}

            {loading && (
              <div className="out-loading">
                <div className="loader" />
                <div className="loader-msg">Parsing AST & building flowchart…</div>
              </div>
            )}

            {error && !loading && (
              <div style={{ padding: 20 }}>
                <div className="err-box" style={{ display: "block" }}>{error}</div>
              </div>
            )}

            {result && !loading && (
              <>
                {activeTab === "diagram" && (
                  <div>
                    <div className="sect-lbl">Interactive Flowchart</div>
                    <FlowDiagram nodes={result.nodes} edges={result.edges} />
                    <div className="stats-row" style={{ marginTop: 14 }}>
                      <span className="stat-pill">🧩 {result.stats.node_count} nodes</span>
                      <span className="stat-pill">🔗 {result.stats.edge_count} edges</span>
                      <span className="stat-pill">📄 {result.stats.lines_parsed} lines</span>
                      <span className="stat-pill">🆔 Code #{result.code_id}</span>
                    </div>
                  </div>
                )}
                {activeTab === "explanation" && (
                  <div>
                    <div className="sect-lbl">Code Explanation</div>
                    <div className="expl-card">{result.explanation}</div>
                  </div>
                )}
                {activeTab === "stats" && (
                  <div>
                    <div className="sect-lbl">Parse Statistics</div>
                    <div className="expl-card">
                      {JSON.stringify(result.stats, null, 2)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   ROOT APP
──────────────────────────────────────────────────────────────────*/
export default function App() {
  const [page, setPage]   = useState("auth");
  const [token, setToken] = useState(() => localStorage.getItem("ragsy_token") || "");
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("ragsy_user") || "null"); } catch { return null; }
  });

  // Auto-restore session
  useEffect(() => {
    if (token && user) setPage("dashboard");
  }, []);

  function handleAuth(tok, usr) {
    setToken(tok); setUser(usr);
    setPage("dashboard");
  }

  function handleSignOut() {
    if (token) apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({ token }) }).catch(() => {});
    localStorage.removeItem("ragsy_token");
    localStorage.removeItem("ragsy_user");
    setToken(""); setUser(null);
    setPage("auth");
  }

  return (
    <>
      <style>{STYLES}</style>
      {page === "auth"      && <AuthPage onAuth={handleAuth} />}
      {page === "dashboard" && <DashboardPage user={user} onNavigate={p => setPage(p)} onSignOut={handleSignOut} />}
      {page === "editor"    && <EditorPage user={user} token={token} onBack={() => setPage("dashboard")} onSignOut={handleSignOut} />}
    </>
  );
}
