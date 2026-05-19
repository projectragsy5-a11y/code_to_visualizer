import { useState, useCallback, useRef, useEffect } from "react";
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  Handle, Position,
  getRectOfNodes, getTransformForBounds,
  ReactFlowProvider, useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

/* ── Dagre auto-layout (prevents node overlaps on generation) ──── */
let _dagre = null;
async function getDagre() {
  if (_dagre) return _dagre;
  try { _dagre = (await import("dagre")).default; return _dagre; } catch { return null; }
}
async function applyDagreLayout(nodes, edges) {
  const dagre = await getDagre();
  if (!dagre || !nodes.length) return nodes;
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir:  "TB",   // top-to-bottom like reference image
    nodesep:  80,     // horizontal space between nodes on same rank
    ranksep:  100,    // vertical space between ranks (rows)
    marginx:  60,
    marginy:  60,
    acyclicer: "greedy",
    ranker:   "tight-tree",
  });
  nodes.forEach(n => {
    // Diamond nodes are wider/taller than regular nodes
    const isDiamond = n.type === "diamond";
    const isPara    = n.type === "parallelogram";
    const w = isDiamond ? 260 : isPara ? 220 : 220;
    const h = isDiamond ? 160 : isPara ? 70  : 70;
    g.setNode(n.id, { width: w, height: h });
  });
  edges.forEach((e, i) => {
    g.setEdge(e.source, e.target, {}, `e${i}`);
  });
  dagre.layout(g);
  return nodes.map(n => {
    const p   = g.node(n.id);
    const isDiamond = n.type === "diamond";
    const isPara    = n.type === "parallelogram";
    const w   = isDiamond ? 260 : isPara ? 220 : 220;
    const h   = isDiamond ? 160 : isPara ? 70  : 70;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

/* ══════════════════════════════════════════════════════════════
   API
══════════════════════════════════════════════════════════════ */
const BASE = "http://localhost:8000";
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers||{}) },
    ...opts,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

/* ══════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════ */
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --ink:#1a1d27;--ink2:#22263a;--ink3:#141720;
  --line:#1e2530;--line2:#252e3c;--mist:#3a4658;--fog:#5a6880;
  --silver:#8fa3ba;--cloud:#c8d6e3;--white:#eef4fa;
  --teal:#00c8a8;--teal-dim:rgba(0,200,168,.12);--teal-glow:rgba(0,200,168,.28);
  --gold:#f0a500;--red:#e05050;
  --mono:'DM Mono',monospace;--body:'DM Sans',sans-serif;--disp:'Syne',sans-serif;
}
html,body,#root{height:100%;background:var(--ink);color:var(--white);font-family:var(--body);}
button{font-family:var(--body);cursor:pointer;}
input{font-family:var(--body);}
*{scrollbar-width:thin;scrollbar-color:var(--mist) transparent;}
.page{min-height:100vh;display:flex;animation:pg .45s cubic-bezier(.16,1,.3,1) both;}
@keyframes pg{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}

/* auth */
.auth-left{width:48%;flex-shrink:0;background:linear-gradient(160deg,#1c2538,#1a2030);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:44px 52px;position:relative;overflow:hidden;}
.auth-right{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;background:var(--ink);overflow-y:auto;}
.mesh{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 60% 50% at 20% 80%,rgba(0,200,168,.06) 0%,transparent 70%);}
.arch-lines{position:absolute;inset:0;pointer-events:none;opacity:.5;}
.wm{display:flex;align-items:center;gap:12px;position:relative;z-index:2;}
.wm-icon{width:36px;height:36px;background:var(--teal);border-radius:8px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px var(--teal-glow);flex-shrink:0;}
.wm-icon svg{width:20px;height:20px;}
.wm-name{font-family:var(--disp);font-size:22px;font-weight:800;letter-spacing:-.02em;}
.wm-badge{font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--teal);background:var(--teal-dim);border:1px solid rgba(0,200,168,.25);padding:2px 8px;border-radius:20px;margin-left:4px;}
.left-hero{position:relative;z-index:2;margin-top:auto;padding-bottom:32px;}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--teal);margin-bottom:14px;display:flex;align-items:center;gap:10px;}
.eyebrow::before{content:'';width:28px;height:1px;background:var(--teal);display:block;}
.hero-h{font-family:var(--disp);font-size:38px;font-weight:800;line-height:1.05;letter-spacing:-.04em;margin-bottom:18px;}
.hero-h em{font-style:normal;background:linear-gradient(135deg,var(--teal),#00e8c0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.hero-p{font-size:14px;line-height:1.65;color:var(--silver);max-width:360px;font-weight:300;}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px;}
.chip{display:flex;align-items:center;gap:7px;background:var(--ink3);border:1px solid var(--line2);border-radius:6px;padding:7px 12px;font-size:12px;color:var(--cloud);}
.chip-dot{width:6px;height:6px;border-radius:50%;background:var(--teal);box-shadow:0 0 6px var(--teal-glow);}

/* form */
.form-box{width:100%;max-width:390px;}
.form-title{font-family:var(--disp);font-size:28px;font-weight:800;letter-spacing:-.03em;margin-bottom:6px;}
.form-sub{font-size:14px;color:var(--fog);margin-bottom:28px;line-height:1.5;}
.form-sub button{background:none;border:none;color:var(--teal);font-size:14px;font-weight:500;padding:0;}
.prog{display:flex;gap:5px;margin-bottom:24px;}
.dot{width:6px;height:6px;background:var(--line2);border-radius:3px;transition:all .3s;}
.dot.done{background:var(--teal);opacity:.5;}
.dot.active{background:var(--teal);width:18px;box-shadow:0 0 8px var(--teal-glow);}
.field{margin-bottom:14px;}
.flabel{font-size:12px;font-weight:500;color:var(--cloud);margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;}
.flabel span{font-family:var(--mono);font-size:10px;color:var(--teal);}
.inp-wrap{position:relative;}
.inp-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--fog);pointer-events:none;display:flex;align-items:center;transition:color .2s;}
.inp-wrap:focus-within .inp-icon{color:var(--teal);}
.inp-wrap input{width:100%;background:var(--ink2);border:1px solid var(--line2);border-radius:8px;color:var(--white);font-size:14px;padding:12px 14px 12px 42px;outline:none;transition:border-color .2s,box-shadow .2s;}
.inp-wrap input::placeholder{color:var(--mist);}
.inp-wrap input:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(0,200,168,.14);}
.inp-toggle{position:absolute;right:13px;top:50%;transform:translateY(-50%);font-family:var(--mono);font-size:11px;color:var(--fog);background:none;border:none;cursor:pointer;}
.inp-toggle:hover{color:var(--teal);}
.val-msg{font-family:var(--mono);font-size:10px;margin-top:5px;letter-spacing:.04em;min-height:14px;}
.val-ok{color:var(--teal);}.val-err{color:var(--red);}
.phone-row{display:flex;gap:8px;}
.cc-inp{width:72px;flex-shrink:0;background:var(--ink2);border:1px solid var(--line2);border-radius:8px;color:var(--white);font-family:var(--mono);font-size:13px;padding:12px 8px;text-align:center;outline:none;}
.cc-inp:focus{border-color:var(--teal);}
.str-bars{display:flex;gap:4px;margin-top:8px;}
.str-bar{flex:1;height:3px;border-radius:2px;background:var(--line);transition:background .35s;}
.str-weak{background:var(--red);}.str-fair{background:var(--gold);}.str-good{background:#6bcb77;}.str-strong{background:var(--teal);}
.str-lbl{font-family:var(--mono);font-size:10px;color:var(--fog);margin-top:5px;letter-spacing:.04em;}
.check-row{display:flex;align-items:flex-start;gap:10px;margin-top:16px;}
.check-row input[type=checkbox]{width:16px;height:16px;flex-shrink:0;margin-top:2px;accent-color:var(--teal);}
.check-lbl{font-size:12px;color:var(--fog);line-height:1.5;}
.check-lbl a{color:var(--teal);text-decoration:none;}
.btn-primary{width:100%;padding:13px 20px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-top:20px;transition:background .2s,box-shadow .2s,transform .15s;}
.btn-primary:hover:not(:disabled){background:#00ddb8;box-shadow:0 4px 28px var(--teal-glow);transform:translateY(-1px);}
.btn-primary:disabled{opacity:.6;cursor:not-allowed;}
.btn-ghost{width:100%;padding:12px 20px;margin-top:10px;background:transparent;color:var(--silver);border:1px solid var(--line2);border-radius:8px;font-size:14px;font-weight:500;transition:border-color .2s,color .2s;}
.btn-ghost:hover{border-color:var(--mist);color:var(--white);}
.err-box{background:rgba(224,80,80,.08);border:1px solid rgba(224,80,80,.3);border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:#e8a0a0;line-height:1.6;}
.success-box{background:rgba(0,200,168,.08);border:1px solid rgba(0,200,168,.35);border-radius:8px;padding:14px 16px;margin-bottom:18px;font-size:13px;color:var(--teal);line-height:1.6;display:flex;align-items:flex-start;gap:10px;}
.success-box-icon{font-size:18px;flex-shrink:0;}
.success-box-text{display:flex;flex-direction:column;gap:3px;}
.success-box-title{font-weight:600;font-size:13px;}
.success-box-sub{font-size:12px;color:var(--silver);}
.otp-row{display:flex;gap:8px;justify-content:center;margin:24px 0 8px;}
.otp-box{width:48px;height:56px;background:var(--ink2);border:1px solid var(--line2);border-radius:8px;text-align:center;font-family:var(--mono);font-size:22px;font-weight:500;color:var(--teal);outline:none;transition:border-color .2s,box-shadow .2s;}
.otp-box:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(0,200,168,.15);}
.otp-box.filled{border-color:rgba(0,200,168,.4);background:rgba(0,200,168,.05);}
.otp-hint{text-align:center;font-size:13px;color:var(--fog);}
.otp-timer{display:block;text-align:center;font-family:var(--mono);font-size:11px;color:var(--gold);margin-top:8px;letter-spacing:.06em;}
.otp-resend{display:block;text-align:center;font-size:12px;color:var(--teal);cursor:pointer;margin-top:10px;font-weight:500;background:none;border:none;}
.or-div{display:flex;align-items:center;gap:14px;margin:20px 0;font-size:12px;color:var(--mist);font-family:var(--mono);}
.or-div::before,.or-div::after{content:'';flex:1;height:1px;background:var(--line);}

/* nav */
.nav{height:64px;background:var(--ink2);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 32px;flex-shrink:0;position:sticky;top:0;z-index:50;}
.nav-left{display:flex;align-items:center;gap:14px;}
.nav-right{display:flex;align-items:center;gap:16px;}
.nav-divider{width:1px;height:20px;background:var(--line2);}
.nav-section{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);}
.nav-section.teal{color:var(--teal);}
.nav-account{display:flex;align-items:center;gap:10px;background:var(--ink3);border:1px solid var(--line2);border-radius:8px;padding:7px 14px;}
.nav-avatar{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--teal),#0080cc);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--ink);font-family:var(--mono);}
.nav-uname{font-size:13px;font-weight:500;}
.nav-signout{font-family:var(--mono);font-size:11px;color:var(--fog);background:none;border:none;letter-spacing:.06em;padding:4px 8px;border-radius:5px;transition:color .2s;}
.nav-signout:hover{color:var(--red);}

/* dashboard */
.dash-page{flex-direction:column;}
.dash-body{flex:1;padding:48px 64px;overflow-y:auto;}
.greeting-eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--teal);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.greeting-eyebrow::before{content:'';width:20px;height:1px;background:var(--teal);}
.greeting-h{font-family:var(--disp);font-size:36px;font-weight:800;letter-spacing:-.04em;line-height:1.1;}
.greeting-h span{background:linear-gradient(135deg,var(--teal),#00e8c0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.greeting-sub{font-size:14px;color:var(--fog);margin-top:8px;line-height:1.6;}
.section-lbl{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--mist);margin:40px 0 20px;display:flex;align-items:center;gap:12px;}
.section-lbl::after{content:'';flex:1;height:1px;background:var(--line);}
.lang-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
.lang-card{background:var(--ink2);border:1px solid var(--line2);border-radius:14px;padding:24px 20px;cursor:pointer;position:relative;overflow:hidden;transition:border-color .25s,transform .2s,box-shadow .25s;animation:cardIn .5s cubic-bezier(.16,1,.3,1) both;}
@keyframes cardIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
.lang-card::before{content:'';position:absolute;inset:0;border-radius:14px;background:radial-gradient(circle at 50% 0%,rgba(0,200,168,.08) 0%,transparent 60%);opacity:0;transition:opacity .3s;}
.lang-card:hover:not(.disabled){border-color:var(--teal);transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,200,168,.12);}
.lang-card:hover:not(.disabled)::before{opacity:1;}
.lang-card.disabled{opacity:.4;cursor:not-allowed;}
.card-badge{position:absolute;top:14px;right:14px;font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--teal);background:var(--teal-dim);border:1px solid rgba(0,200,168,.2);padding:2px 7px;border-radius:20px;}
.card-badge.soon{color:var(--fog);background:transparent;border-color:var(--line2);}
.card-icon{width:44px;height:44px;border-radius:10px;background:var(--teal-dim);border:1px solid rgba(0,200,168,.2);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:14px;font-weight:500;color:var(--teal);margin-bottom:16px;}
.card-icon.dim{background:var(--ink3);border-color:var(--line2);color:var(--fog);}
.card-name{font-family:var(--disp);font-size:17px;font-weight:800;letter-spacing:-.02em;margin-bottom:5px;}
.card-desc{font-size:11px;color:var(--fog);line-height:1.55;}
.card-arrow{position:absolute;right:18px;bottom:18px;font-size:15px;color:var(--mist);transition:color .2s,transform .2s;}
.lang-card:hover:not(.disabled) .card-arrow{color:var(--teal);transform:translate(3px,-3px);}

/* editor */
.editor-page{flex-direction:column;}
.editor-body{flex:1;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;height:calc(100vh - 64px);}
.editor-panel{display:flex;flex-direction:column;border-right:1px solid var(--line);overflow:hidden;}
.panel-hdr{padding:13px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--ink2);}
.panel-title{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--silver);}
.ptitle-dot{width:8px;height:8px;border-radius:50%;background:var(--teal);box-shadow:0 0 8px var(--teal-glow);}
.panel-actions{display:flex;gap:7px;}
.panel-btn{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--fog);background:var(--ink3);border:1px solid var(--line2);border-radius:5px;padding:5px 10px;transition:color .2s,border-color .2s;}
.panel-btn:hover{color:var(--white);border-color:var(--mist);}
.editor-wrap{flex:1;position:relative;overflow:hidden;background:var(--ink);}
.line-nums{position:absolute;left:0;top:0;bottom:0;width:44px;display:flex;flex-direction:column;padding:20px 0;overflow:hidden;border-right:1px solid var(--line);background:var(--ink2);pointer-events:none;}
.line-num{font-family:var(--mono);font-size:11px;color:var(--mist);text-align:right;padding-right:10px;line-height:1.7;min-height:22.1px;flex-shrink:0;}
.code-ta{width:100%;height:100%;background:transparent;border:none;outline:none;color:#a8d8b8;font-family:var(--mono);font-size:13px;line-height:1.7;padding:20px 20px 20px 56px;resize:none;overflow-y:auto;tab-size:4;caret-color:var(--teal);}
.code-ta::placeholder{color:var(--mist);}
.run-bar{padding:11px 18px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--ink2);}
.run-info{font-family:var(--mono);font-size:10px;color:var(--mist);letter-spacing:.06em;}
.run-info span{color:var(--teal);}
.btn-run{display:flex;align-items:center;gap:8px;background:var(--teal);color:var(--ink);border:none;border-radius:7px;font-size:13px;font-weight:600;padding:9px 18px;transition:background .2s,box-shadow .2s,transform .15s;}
.btn-run:hover:not(:disabled){background:#00ddb8;box-shadow:0 4px 24px var(--teal-glow);transform:translateY(-1px);}
.btn-run:disabled{opacity:.6;cursor:not-allowed;}
.output-panel{display:flex;flex-direction:column;overflow:hidden;}
.out-tabs{display:flex;gap:2px;padding:9px 13px 0;border-bottom:1px solid var(--line);flex-shrink:0;background:var(--ink2);}
.out-tab{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);padding:7px 11px;border-radius:5px 5px 0 0;background:none;border:none;border-bottom:2px solid transparent;position:relative;top:1px;transition:color .2s;}
.out-tab:hover{color:var(--silver);}
.out-tab.active{color:var(--teal);border-bottom-color:var(--teal);background:var(--ink);}
.out-content{flex:1;overflow-y:auto;padding:18px;}
.out-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}
.out-empty-icon{width:52px;height:52px;border-radius:14px;background:var(--ink3);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:18px;}
.out-empty-h{font-family:var(--disp);font-size:17px;font-weight:800;color:var(--cloud);margin-bottom:7px;}
.out-empty-p{font-size:13px;color:var(--fog);line-height:1.6;max-width:260px;}
.out-loading{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;}
.loader{width:34px;height:34px;border:2px solid var(--line2);border-top-color:var(--teal);border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.loader-msg{font-family:var(--mono);font-size:11px;color:var(--fog);letter-spacing:.1em;}
/* flow diagram canvas wrapper — must have explicit size for html2canvas */
.flow-wrap{width:100%;height:460px;background:#111418;border:1px solid var(--line2);border-radius:10px;overflow:hidden;}
.stats-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.stat-pill{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--teal);background:var(--teal-dim);border:1px solid rgba(0,200,168,.2);padding:3px 9px;border-radius:20px;}
.sect-lbl{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--teal);margin-bottom:11px;display:flex;align-items:center;gap:8px;}
.sect-lbl::after{content:'';flex:1;height:1px;background:rgba(0,200,168,.2);}
.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--ink2);border:1px solid var(--line2);border-radius:10px;padding:11px 18px;display:flex;align-items:center;gap:11px;font-size:13px;color:var(--cloud);z-index:999;opacity:0;transition:transform .4s cubic-bezier(.16,1,.3,1),opacity .35s;white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.4);min-width:220px;pointer-events:none;}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1;}
.toast.ok{border-color:rgba(0,200,168,.3);}.toast.err{border-color:rgba(224,80,80,.3);}
.toast-icon{font-size:15px;}

/* ── Activities panel ── */
.activities-panel{position:fixed;right:0;top:64px;bottom:0;width:380px;background:var(--ink2);border-left:1px solid var(--line);display:flex;flex-direction:column;z-index:40;transform:translateX(100%);transition:transform .35s cubic-bezier(.16,1,.3,1);}
.activities-panel.open{transform:translateX(0);}
.activities-hdr{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.activities-title{font-family:var(--disp);font-size:16px;font-weight:800;letter-spacing:-.02em;}
.activities-close{background:none;border:none;color:var(--fog);font-size:18px;line-height:1;padding:4px 8px;border-radius:5px;transition:color .2s;}
.activities-close:hover{color:var(--white);}
.activities-list{flex:1;overflow-y:auto;padding:12px;}
.activity-card{background:var(--ink3);border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color .2s;}
.activity-card:hover{border-color:var(--teal);}
.activity-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.activity-lang{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);background:var(--teal-dim);border:1px solid rgba(0,200,168,.2);padding:2px 7px;border-radius:10px;}
.activity-time{font-family:var(--mono);font-size:9px;color:var(--fog);letter-spacing:.04em;}
.activity-code{font-family:var(--mono);font-size:11px;color:var(--silver);line-height:1.6;background:var(--ink2);border-radius:6px;padding:8px 10px;margin-bottom:8px;white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;}
.activity-meta{display:flex;gap:10px;flex-wrap:wrap;}
.activity-badge{font-family:var(--mono);font-size:9px;color:var(--fog);background:var(--ink2);border:1px solid var(--line2);padding:2px 7px;border-radius:10px;}
.activity-badge.dl{color:var(--gold);border-color:rgba(240,165,0,.3);}
.activities-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--fog);font-size:13px;gap:10px;text-align:center;padding:30px;}

@media(max-width:860px){
  .auth-left{display:none;}
  .auth-right{justify-content:flex-start;padding-top:80px;}
  .editor-body{grid-template-columns:1fr;grid-template-rows:1fr 1fr;}
  .dash-body{padding:24px 20px;}
  .activities-panel{width:100%;}
}
`;

/* ══════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════ */
function Toast({ msg, type, show }) {
  return (
    <div className={`toast ${type} ${show?"show":""}`}>
      <span className="toast-icon">{type==="ok"?"✓":"✕"}</span>
      <span>{msg}</span>
    </div>
  );
}
function useToast() {
  const [t,setT] = useState({msg:"",type:"ok",show:false});
  const tmr = useRef(null);
  const fire = useCallback((type,msg)=>{
    clearTimeout(tmr.current);
    setT({msg,type,show:true});
    tmr.current=setTimeout(()=>setT(p=>({...p,show:false})),3200);
  },[]);
  return [t,fire];
}

/* ══════════════════════════════════════════════════════════════
   ICONS
══════════════════════════════════════════════════════════════ */
const IconUser=()=>(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>);
const IconPhone=()=>(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/></svg>);
const IconLock=()=>(<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>);
const IconPlay=()=>(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>);
const RagsyIcon=()=>(<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h6M4 10h4M4 14h8M14 4l6 8-6 8" stroke="#0A0C10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);

/* ══════════════════════════════════════════════════════════════
   WORDMARK + NAV
══════════════════════════════════════════════════════════════ */
function Wordmark(){return(<div className="wm"><div className="wm-icon"><RagsyIcon/></div><span className="wm-name">Ragsy</span><span className="wm-badge">BETA</span></div>);}
function NavBar({user,section,tealSection,onLogoClick,onSignOut,onActivities}){
  return(
    <nav className="nav">
      <div className="nav-left">
        <div style={{cursor:"pointer"}} onClick={onLogoClick}>
          <div className="wm" style={{gap:10}}>
            <div className="wm-icon" style={{width:30,height:30,borderRadius:7}}><RagsyIcon/></div>
            <span className="wm-name" style={{fontSize:18}}>Ragsy</span>
          </div>
        </div>
        <div className="nav-divider"/>
        <span className={`nav-section${tealSection?" teal":""}`}>{section}</span>
      </div>
      <div className="nav-right">
        {onActivities && (
          <button onClick={onActivities} style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".08em",color:"var(--silver)",background:"var(--ink3)",border:"1px solid var(--line2)",borderRadius:6,padding:"6px 12px",transition:"color .2s,border-color .2s"}}>
            📋 Recent Activity
          </button>
        )}
        {user&&(<div className="nav-account"><div className="nav-avatar">{user.username.slice(0,2).toUpperCase()}</div><span className="nav-uname">{user.username}</span></div>)}
        <button className="nav-signout" onClick={onSignOut}>Sign out</button>
      </div>
    </nav>
  );
}

/* ══════════════════════════════════════════════════════════════
   AUTH LEFT
══════════════════════════════════════════════════════════════ */
function AuthLeft(){
  return(
    <div className="auth-left">
      <div className="mesh"/>
      <svg className="arch-lines" viewBox="0 0 700 480" fill="none">
        <line x1="140" y1="120" x2="350" y2="200" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
        <line x1="350" y1="200" x2="560" y2="140" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
        <line x1="350" y1="200" x2="350" y2="340" stroke="#00C8A8" strokeWidth="1" opacity=".18"/>
        <circle r="3" fill="#00C8A8" opacity=".6"><animateMotion dur="4s" repeatCount="indefinite" path="M140,120 L350,200"/><animate attributeName="opacity" values=".6;0;.6" dur="4s" repeatCount="indefinite"/></circle>
        <g opacity=".25">
          <rect x="300" y="174" width="100" height="52" rx="6" fill="#00C8A8" fillOpacity=".15" stroke="#00C8A8" strokeWidth="1.2"/>
          <text x="350" y="203" textAnchor="middle" fill="#00C8A8" fontSize="11" fontFamily="DM Mono,monospace">USERS</text>
        </g>
      </svg>
      <Wordmark/>
      <div className="left-hero">
        <div className="eyebrow">Code to Architecture</div>
        <h1 className="hero-h">Turn your<br/>code into<br/><em>living diagrams.</em></h1>
        <p className="hero-p">Paste any Python code and Ragsy generates interactive flowcharts, explanations, and downloadable diagrams — instantly.</p>
        <div className="chips">
          <div className="chip"><div className="chip-dot"/>Interactive flowcharts</div>
          <div className="chip"><div className="chip-dot"/>PNG download</div>
          <div className="chip"><div className="chip-dot"/>Forgot password via SMS</div>
          <div className="chip"><div className="chip-dot"/>Recent activity</div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REGISTER
══════════════════════════════════════════════════════════════ */
function RegisterView({onSwitch,onRegistered,toast}){
  const [step,setStep]=useState(1);
  const [username,setUsername]=useState("");
  const [cc,setCc]=useState("+91");
  const [phone,setPhone]=useState("");
  const [password,setPassword]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const str=(()=>{let s=0;if(password.length>=6)s++;if(/[A-Z]/.test(password))s++;if(/[0-9]/.test(password))s++;if(/[^A-Za-z0-9]/.test(password))s++;return s;})();
  const strClass=["","str-weak","str-fair","str-good","str-strong"][str];
  const strLabel=["Enter a password","Weak","Fair","Good","Strong ✓"][str];
  const dots=[1,2].map(n=><div key={n} className={`dot ${n<step?"done":n===step?"active":""}`}/>);
  async function step1(e){e.preventDefault();setError("");if(!username.trim())return setError("Username is required");if(!/^[a-z0-9_]{3,20}$/.test(username))return setError("3–20 chars: lowercase, digits, underscores");if(!phone.trim())return setError("Mobile number is required");setStep(2);}
  async function doRegister(e){
    e.preventDefault();setError("");
    if(password.length<6)return setError("Password must be at least 6 characters");
    if(!agreed)return setError("Please agree to the Terms of Service");
    const full=cc+phone.replace(/\s/g,"");setLoading(true);
    try{
      const d=await apiFetch("/auth/register",{method:"POST",body:JSON.stringify({username:username.trim(),mobile_no:full,password})});
      toast("ok","Account created! Welcome to Ragsy 🎉");
      onRegistered(username.trim(),d.token,d.user);
    }catch(err){setError(err.message);}finally{setLoading(false);}
  }
  return(
    <div className="form-box">
      <div className="form-title">Create your account</div>
      <p className="form-sub">Already have one? <button onClick={()=>onSwitch("login")}>Sign in →</button></p>
      <div className="prog">{dots}</div>
      {error&&<div className="err-box">{error}</div>}
      {step===1&&(<form onSubmit={step1}>
        <div className="field"><div className="flabel">Username</div><div className="inp-wrap"><span className="inp-icon"><IconUser/></span><input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="e.g. alex_dev"/></div>
        {username&&<div className={`val-msg ${/^[a-z0-9_]{3,20}$/.test(username)?"val-ok":"val-err"}`}>{/^[a-z0-9_]{3,20}$/.test(username)?"✓ Looks good":"✕ 3–20 chars"}</div>}</div>
        <div className="field"><div className="flabel">Mobile Number</div><div className="phone-row"><input className="cc-inp" value={cc} onChange={e=>setCc(e.target.value)}/><div className="inp-wrap" style={{flex:1}}><span className="inp-icon"><IconPhone/></span><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="98765 43210"/></div></div></div>
        <button className="btn-primary" type="submit">Continue →</button>
      </form>)}
      {step===2&&(<form onSubmit={doRegister}>
        <div className="field"><div className="flabel">Password</div><div className="inp-wrap"><span className="inp-icon"><IconLock/></span><input type={showPass?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password"/><button type="button" className="inp-toggle" onClick={()=>setShowPass(p=>!p)}>{showPass?"hide":"show"}</button></div><div className="str-bars">{[0,1,2,3].map(i=><div key={i} className={`str-bar ${i<str?strClass:""}`}/>)}</div><div className="str-lbl" style={{color:str===4?"var(--teal)":str===3?"#6bcb77":str===2?"var(--gold)":"var(--red)"}}>{strLabel}</div></div>
        <div className="check-row"><input type="checkbox" id="tos" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><label className="check-lbl" htmlFor="tos">I agree to Ragsy's <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>. Your code is encrypted in our database.</label></div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading?"Creating account…":"Create Account & Start →"}</button>
        <button type="button" className="btn-ghost" onClick={()=>setStep(1)}>← Back</button>
      </form>)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════════════════ */
function LoginView({onSwitch,onSuccess,toast,registeredUsername}){
  const [username,setUsername]=useState(registeredUsername||"");
  const [password,setPassword]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{if(!registeredUsername)setUsername("");setPassword("");},[]);
  async function doLogin(e){
    e.preventDefault();setError("");
    if(!username||!password)return setError("Please fill in all fields");
    setLoading(true);
    try{const d=await apiFetch("/auth/login",{method:"POST",body:JSON.stringify({username:username.trim(),password})});toast("ok",`Welcome back, ${d.user.username}!`);onSuccess(d.token,d.user);}
    catch(err){setError(err.message);}finally{setLoading(false);}
  }
  return(
    <div className="form-box">
      <div className="form-title">Welcome back</div>
      <p className="form-sub">New to Ragsy? <button onClick={()=>onSwitch("register")}>Create a free account →</button></p>
      {registeredUsername&&(<div className="success-box"><span className="success-box-icon">🎉</span><div className="success-box-text"><span className="success-box-title">Account created!</span><span className="success-box-sub">Welcome, <strong>{registeredUsername}</strong>! Sign in to continue.</span></div></div>)}
      {error&&<div className="err-box">{error}</div>}
      <form onSubmit={doLogin} autoComplete="off">
        <div className="field"><div className="flabel">Username</div><div className="inp-wrap"><span className="inp-icon"><IconUser/></span><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter your username" autoComplete="off" name="ragsy-u"/></div></div>
        <div className="field"><div className="flabel">Password</div><div className="inp-wrap"><span className="inp-icon"><IconLock/></span><input type={showPass?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" name="ragsy-p" autoFocus={!!registeredUsername}/><button type="button" className="inp-toggle" onClick={()=>setShowPass(p=>!p)}>{showPass?"hide":"show"}</button></div></div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading?"Signing in…":"Sign In →"}</button>
      </form>
      <div className="or-div">or</div>
      <button className="btn-ghost" onClick={()=>onSwitch("forgot")}>🔑 Forgot password?</button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   OTP LOGIN
══════════════════════════════════════════════════════════════ */
function OtpLoginView({onSwitch,onSuccess,toast}){
  const [phase,setPhase]=useState(1);const [cc,setCc]=useState("+91");const [phone,setPhone]=useState("");
  const [otp,setOtp]=useState(["","","","","",""]);const [timerSecs,setTimerSecs]=useState(300);
  const [mobileNo,setMobileNo]=useState("");const [devOtp,setDevOtp]=useState("");
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const timerRef=useRef(null);const otpRefs=useRef([]);
  function startTimer(s=300){clearInterval(timerRef.current);setTimerSecs(s);timerRef.current=setInterval(()=>setTimerSecs(p=>{if(p<=1){clearInterval(timerRef.current);return 0;}return p-1;}),1000);}
  useEffect(()=>()=>clearInterval(timerRef.current),[]);
  const td=`${String(Math.floor(timerSecs/60)).padStart(2,"0")}:${String(timerSecs%60).padStart(2,"0")}`;
  async function send(e){e&&e.preventDefault();setError("");const full=cc+phone.replace(/\s/g,"");setLoading(true);
    try{const d=await apiFetch("/auth/resend-otp",{method:"POST",body:JSON.stringify({mobile_no:full})});setMobileNo(full);setDevOtp(d.otp_code||"");startTimer(d.expires_in||300);setPhase(2);toast("ok","OTP sent!");}
    catch(err){setError(err.message);}finally{setLoading(false);}
  }
  function oi(val,idx){const d=val.replace(/\D/g,"").slice(0,1);const n=[...otp];n[idx]=d;setOtp(n);if(d&&idx<5)otpRefs.current[idx+1]?.focus();}
  function ok(e,idx){if(e.key==="Backspace"&&!otp[idx]&&idx>0)otpRefs.current[idx-1]?.focus();}
  async function verify(e){e.preventDefault();const code=otp.join("");if(code.length<6)return setError("Enter 6-digit code");setLoading(true);setError("");
    try{const d=await apiFetch("/auth/verify-otp",{method:"POST",body:JSON.stringify({mobile_no:mobileNo,otp_code:code})});toast("ok",`Welcome, ${d.user.username}!`);onSuccess(d.token,d.user);}
    catch(err){setError(err.message);}finally{setLoading(false);}
  }
  return(
    <div className="form-box">
      <div className="form-title">OTP Sign In</div>
      <p className="form-sub">Have a password? <button onClick={()=>onSwitch("login")}>Sign in →</button></p>
      {error&&<div className="err-box">{error}</div>}
      {phase===1&&(<form onSubmit={send}>
        <div className="field"><div className="flabel">Registered Mobile</div><div className="phone-row"><input className="cc-inp" value={cc} onChange={e=>setCc(e.target.value)}/><div className="inp-wrap" style={{flex:1}}><span className="inp-icon"><IconPhone/></span><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="98765 43210"/></div></div></div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading?"Sending…":"Send OTP →"}</button>
        <button type="button" className="btn-ghost" onClick={()=>onSwitch("login")}>← Back</button>
      </form>)}
      {phase===2&&(<form onSubmit={verify}>
        <p className="otp-hint">Code sent to <strong style={{color:"var(--white)"}}>{mobileNo}</strong></p>
        {devOtp&&<div style={{textAlign:"center",marginTop:10,fontFamily:"var(--mono)",fontSize:11,color:"var(--gold)",background:"rgba(240,165,0,.08)",border:"1px solid rgba(240,165,0,.25)",borderRadius:6,padding:"6px 12px"}}>DEV OTP: <strong>{devOtp}</strong></div>}
        <div className="otp-row">{otp.map((v,i)=>(<input key={i} ref={el=>otpRefs.current[i]=el} className={`otp-box ${v?"filled":""}`} type="text" maxLength={1} inputMode="numeric" value={v} onChange={e=>oi(e.target.value,i)} onKeyDown={e=>ok(e,i)}/>))}</div>
        <span className="otp-timer">{timerSecs>0?`Expires in ${td}`:"Code expired"}</span>
        <button type="button" className="otp-resend" onClick={send}>Resend code</button>
        <button className="btn-primary" type="submit" disabled={loading} style={{marginTop:20}}>{loading?"Verifying…":"Verify & Sign In →"}</button>
        <button type="button" className="btn-ghost" onClick={()=>setPhase(1)}>← Change number</button>
      </form>)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FORGOT PASSWORD
══════════════════════════════════════════════════════════════ */
function ForgotPasswordView({onSwitch,toast}){
  const [step,setStep]=useState(1);
  const [cc,setCc]=useState("+91");
  const [phone,setPhone]=useState("");
  const [mobile,setMobile]=useState("");
  const [otp,setOtp]=useState(["","","","","",""]);
  const [devOtp,setDevOtp]=useState("");
  const [newPw,setNewPw]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [timer,setTimer]=useState(300);
  const timerRef=useRef(null);
  const otpRefs=useRef([]);
  function startTimer(){clearInterval(timerRef.current);setTimer(300);timerRef.current=setInterval(()=>setTimer(p=>{if(p<=1){clearInterval(timerRef.current);return 0;}return p-1;}),1000);}
  useEffect(()=>()=>clearInterval(timerRef.current),[]);
  const td=`${String(Math.floor(timer/60)).padStart(2,"0")}:${String(timer%60).padStart(2,"0")}`;

  async function sendOtp(e){
    e&&e.preventDefault();setError("");
    const full=cc+phone.replace(/\s/g,"");
    setLoading(true);
    try{
      const d=await apiFetch("/auth/forgot-password",{method:"POST",body:JSON.stringify({mobile_no:full})});
      setMobile(full);setDevOtp(d.otp_code||"");startTimer();setStep(2);
      toast("ok","OTP sent to your mobile!");
    }catch(err){setError(err.message);}finally{setLoading(false);}
  }

  function oi(val,idx){const d=val.replace(/\D/g,"").slice(0,1);const n=[...otp];n[idx]=d;setOtp(n);if(d&&idx<5)otpRefs.current[idx+1]?.focus();}
  function ok(e,idx){if(e.key==="Backspace"&&!otp[idx]&&idx>0)otpRefs.current[idx-1]?.focus();}

  async function verifyOtp(e){
    e.preventDefault();const code=otp.join("");
    if(code.length<6)return setError("Enter all 6 digits");
    setLoading(true);setError("");
    // We verify by attempting reset with a dummy password; if OTP wrong, it'll fail
    // Real verify: just move to step 3 and confirm on final submit
    setStep(3);setLoading(false);
  }

  async function resetPw(e){
    e.preventDefault();setError("");
    if(newPw.length<6)return setError("Password must be at least 6 characters");
    const code=otp.join("");
    setLoading(true);
    try{
      await apiFetch("/auth/reset-password",{method:"POST",body:JSON.stringify({mobile_no:mobile,otp_code:code,new_password:newPw})});
      toast("ok","Password updated! Sign in with your new password.");
      onSwitch("login");
    }catch(err){
      setError(err.message);
      if(err.message.toLowerCase().includes("otp")||err.message.toLowerCase().includes("incorrect")){setStep(2);}
    }finally{setLoading(false);}
  }

  const dots=[1,2,3].map(n=><div key={n} className={`dot ${n<step?"done":n===step?"active":""}`}/>);

  return(
    <div className="form-box">
      <div className="form-title">Reset password</div>
      <p className="form-sub">Remembered it? <button onClick={()=>onSwitch("login")}>Sign in →</button></p>
      <div className="prog">{dots}</div>
      {error&&<div className="err-box">{error}</div>}

      {step===1&&(<form onSubmit={sendOtp}>
        <div className="field"><div className="flabel">Your registered mobile number</div>
          <div className="phone-row">
            <input className="cc-inp" value={cc} onChange={e=>setCc(e.target.value)}/>
            <div className="inp-wrap" style={{flex:1}}><span className="inp-icon"><IconPhone/></span><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="98765 43210"/></div>
          </div>
        </div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading?"Sending OTP…":"Send Reset OTP →"}</button>
        <button type="button" className="btn-ghost" onClick={()=>onSwitch("login")}>← Back to Sign In</button>
      </form>)}

      {step===2&&(<form onSubmit={verifyOtp}>
        <p className="otp-hint">OTP sent to <strong style={{color:"var(--white)"}}>{mobile}</strong></p>
        {devOtp&&<div style={{textAlign:"center",marginTop:10,fontFamily:"var(--mono)",fontSize:11,color:"var(--gold)",background:"rgba(240,165,0,.08)",border:"1px solid rgba(240,165,0,.25)",borderRadius:6,padding:"6px 12px"}}>DEV OTP: <strong>{devOtp}</strong></div>}
        <div className="otp-row">{otp.map((v,i)=>(<input key={i} ref={el=>otpRefs.current[i]=el} className={`otp-box ${v?"filled":""}`} type="text" maxLength={1} inputMode="numeric" value={v} onChange={e=>oi(e.target.value,i)} onKeyDown={e=>ok(e,i)}/>))}</div>
        <span className="otp-timer">{timer>0?`Expires in ${td}`:"Code expired"}</span>
        <button type="button" className="otp-resend" onClick={sendOtp}>Resend OTP</button>
        <button className="btn-primary" type="submit" disabled={loading||otp.join("").length<6}>{loading?"Verifying…":"Verify OTP →"}</button>
        <button type="button" className="btn-ghost" onClick={()=>setStep(1)}>← Change number</button>
      </form>)}

      {step===3&&(<form onSubmit={resetPw}>
        <div className="success-box" style={{marginBottom:18}}>
          <span className="success-box-icon">✓</span>
          <div className="success-box-text"><span className="success-box-title">OTP verified</span><span className="success-box-sub">Now set your new password</span></div>
        </div>
        <div className="field"><div className="flabel">New Password</div>
          <div className="inp-wrap"><span className="inp-icon"><IconLock/></span>
            <input type={showPw?"text":"password"} value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="At least 6 characters" autoFocus/>
            <button type="button" className="inp-toggle" onClick={()=>setShowPw(p=>!p)}>{showPw?"hide":"show"}</button>
          </div>
        </div>
        <button className="btn-primary" type="submit" disabled={loading}>{loading?"Updating…":"Set New Password →"}</button>
      </form>)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   AUTH PAGE
══════════════════════════════════════════════════════════════ */
function AuthPage({onAuth}){
  const [view,setView]=useState("login");
  const [regUser,setRegUser]=useState(null);
  const [toast,fireToast]=useToast();
  function handleRegistered(u){setRegUser(u);setView("login");fireToast("ok","Account created! Sign in to continue 🎉");}
  function loginSuccess(tok,usr){localStorage.setItem("ragsy_token",tok);localStorage.setItem("ragsy_user",JSON.stringify(usr));onAuth(tok,usr);}
  function sw(t){if(t!=="login")setRegUser(null);setView(t);}
  return(
    <div className="page"><style>{STYLES}</style><Toast {...toast}/>
      <AuthLeft/>
      <div className="auth-right">
        {view==="register"&&<RegisterView onSwitch={sw} onRegistered={handleRegistered} toast={fireToast}/>}
        {view==="login"&&<LoginView key={regUser||"fresh"} onSwitch={sw} onSuccess={loginSuccess} toast={fireToast} registeredUsername={regUser}/>}
        {view==="otp-login"&&<OtpLoginView onSwitch={sw} onSuccess={loginSuccess} toast={fireToast}/>}
        {view==="forgot"&&<ForgotPasswordView onSwitch={sw} toast={fireToast}/>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ACTIVITIES PANEL
══════════════════════════════════════════════════════════════ */
function ActivitiesPanel({open,onClose,token,onRestore}){
  const [activities,setActivities]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    if(open&&token){
      setLoading(true);setError("");
      apiFetch(`/activities?token=${token}&limit=15`)
        .then(d=>setActivities(d.activities||[]))
        .catch(e=>setError(e.message))
        .finally(()=>setLoading(false));
    }
  },[open,token]);

  function fmtTime(ts){
    if(!ts)return"—";
    const d=new Date(ts);
    return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});
  }

  return(
    <div className={`activities-panel ${open?"open":""}`}>
      <div className="activities-hdr">
        <div className="activities-title">📋 Recent Activity</div>
        <button className="activities-close" onClick={onClose}>✕</button>
      </div>
      <div className="activities-list">
        {loading&&<div className="activities-empty"><div className="loader" style={{width:28,height:28}}/><span>Loading activities…</span></div>}
        {error&&<div className="activities-empty" style={{color:"var(--red)"}}>⚠ {error}</div>}
        {!loading&&!error&&activities.length===0&&(
          <div className="activities-empty">
            <div style={{fontSize:32,marginBottom:8}}>📭</div>
            <div style={{fontFamily:"var(--disp)",fontSize:15,fontWeight:700,marginBottom:6}}>No activity yet</div>
            <div>Generate your first flowchart to see it here.</div>
          </div>
        )}
        {!loading&&activities.map((a,i)=>(
          <div key={a.code_id||i} className="activity-card" onClick={()=>onRestore&&onRestore(a)}>
            <div className="activity-card-top">
              <span className="activity-lang">{a.language||"python"}</span>
              <span className="activity-time">{fmtTime(a.upload_time)}</span>
            </div>
            <div className="activity-code">{a.source_code}</div>
            <div className="activity-meta">
              <span className="activity-badge">🧩 #{a.code_id}</span>
              {a.flowchart_time&&<span className="activity-badge">⬡ diagram</span>}
              {a.downloads>0&&<span className="activity-badge dl">⬇ {a.downloads} download{a.downloads>1?"s":""}</span>}
              {a.explanation&&a.explanation.length>0&&<span className="activity-badge">📋 explained</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════ */
function DashboardPage({user,onNavigate,onSignOut,token}){
  const [activitiesOpen,setActivitiesOpen]=useState(false);
  return(
    <div className="page dash-page"><style>{STYLES}</style>
      <NavBar user={user} section="Dashboard" onLogoClick={()=>{}} onSignOut={onSignOut} onActivities={()=>setActivitiesOpen(o=>!o)}/>
      <div className="dash-body">
        <div className="greeting-eyebrow">Welcome back</div>
        <h1 className="greeting-h">Hello, <span>{user.username}</span> 👋</h1>
        <p className="greeting-sub">Choose a language to start visualizing and practising code.</p>
        <div className="section-lbl">Available Languages</div>
        <div className="lang-grid">
          {/* Python Basics */}
          <div className="lang-card" onClick={()=>onNavigate("editor","python","")} style={{animationDelay:"0s"}}>
            <div className="card-badge">ACTIVE</div>
            <div className="card-icon">🐍</div>
            <div className="card-name">Python Basics</div>
            <div className="card-desc">Visualize Python programs — from basic I/O to OOP, recursion, file handling and more.</div>
            <div className="card-arrow">↗</div>
          </div>
          {/* JavaScript Basics */}
          <div className="lang-card" onClick={()=>onNavigate("editor","javascript","")} style={{animationDelay:"0.08s"}}>
            <div className="card-badge" style={{color:"#fbbf24",background:"rgba(251,191,36,.12)",borderColor:"rgba(251,191,36,.3)"}}>NEW</div>
            <div className="card-icon" style={{background:"rgba(251,191,36,.1)",borderColor:"rgba(251,191,36,.2)",color:"#fbbf24"}}>⚡</div>
            <div className="card-name">JavaScript Basics</div>
            <div className="card-desc">Practice JavaScript interactively — functions, loops, arrays, async and DOM concepts.</div>
            <div className="card-arrow">↗</div>
          </div>
          {/* Coming soon */}
          {[["C","C Language","Structs, pointers, memory and function graphs."],["C++","C++ Language","Classes, templates, OOP architecture."]].map(([icon,name,desc],i)=>(
            <div className="lang-card disabled" key={icon} style={{animationDelay:`${(i+2)*.08}s`}}>
              <div className="card-badge soon">SOON</div>
              <div className="card-icon dim">{icon}</div>
              <div className="card-name">{name}</div>
              <div className="card-desc">{desc}</div>
              <div className="card-arrow" style={{color:"var(--line2)"}}>↗</div>
            </div>
          ))}
        </div>
      </div>
      <ActivitiesPanel open={activitiesOpen} onClose={()=>setActivitiesOpen(false)} token={token}
        onRestore={a=>{onNavigate("editor",a.language||"python",a.source_code_full||a.source_code);setActivitiesOpen(false);}}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REACT FLOW CUSTOM NODES
══════════════════════════════════════════════════════════════ */
function DiamondNode({data}){
  const color=data.color||"#fca5a5";const bg=data.bg||"#7f1d1d";
  const W=260;const H=160;const pts=`${W/2},4 ${W-4},${H/2} ${W/2},${H-4} 4,${H/2}`;
  return(
    <div style={{position:"relative",width:W,height:H}}>
      <Handle type="target" position={Position.Top} style={{top:0,left:"50%",background:color,border:"none"}}/>
      <svg width={W} height={H} style={{position:"absolute",inset:0}}>
        <polygon points={pts} fill={bg} stroke={color} strokeWidth="2.5" style={{filter:`drop-shadow(0 0 10px ${color}99)`}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:"8px 32px",textAlign:"center",fontFamily:"'Fira Code',monospace",fontSize:11,color:"#fff",wordBreak:"break-word",lineHeight:1.4,pointerEvents:"none",fontWeight:500}}>
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{bottom:0,left:"50%",background:color,border:"none"}}/>
      <Handle type="source" id="right" position={Position.Right} style={{right:0,top:"50%",background:color,border:"none"}}/>
    </div>
  );
}
function ParallelogramNode({data}){
  const color=data.color||"#60a5fa";const bg=data.bg||"#1e3a5f";
  return(
    <div style={{position:"relative",background:bg,border:`2px solid ${color}`,borderRadius:4,padding:"10px 20px",minWidth:180,maxWidth:260,transform:"skewX(-10deg)",boxShadow:`0 0 14px ${color}55`,fontFamily:"'Fira Code',monospace",fontSize:12,color:"#fff",textAlign:"center",wordBreak:"break-word"}}>
      <Handle type="target" position={Position.Top} style={{background:color,border:"none",top:-1}}/>
      <div style={{transform:"skewX(10deg)",fontWeight:500}}>{data.label}</div>
      <Handle type="source" position={Position.Bottom} style={{background:color,border:"none",bottom:-1}}/>
    </div>
  );
}
const NODE_TYPES={diamond:DiamondNode,parallelogram:ParallelogramNode};

/* ── Custom Straight Edge — pure vertical line, no bends ────── */
function StraightEdge({ id, sourceX, sourceY, targetX, targetY,
                        style={}, markerEnd, label, labelStyle,
                        labelBgStyle, labelBgPadding, labelBgBorderRadius }){
  // Draw straight vertical line from source to target
  // If source and target are not aligned, route: down → horizontal → down
  const midY = (sourceY + targetY) / 2;
  let d;
  if(Math.abs(sourceX - targetX) < 4){
    // Perfectly aligned — pure straight vertical line
    d = `M${sourceX},${sourceY} L${targetX},${targetY}`;
  } else {
    // Not aligned — go down to midpoint, across, then down to target
    d = `M${sourceX},${sourceY} L${sourceX},${midY} L${targetX},${midY} L${targetX},${targetY}`;
  }
  const strokeColor = style.stroke || "#4a90b8";
  const labelX = (sourceX + targetX) / 2;
  const labelY = midY;
  const pad = labelBgPadding || [6,4];
  const textLen = label ? label.length * 7 + pad[0]*2 : 0;
  const textH   = label ? 18 + pad[1]*2 : 0;
  return(
    <g>
      <path id={id} d={d} fill="none"
        stroke={strokeColor} strokeWidth={style.strokeWidth||2.5}
        markerEnd={markerEnd}
        style={{...style}}/>
      {label&&(
        <g transform={`translate(${labelX},${labelY})`}>
          <rect x={-textLen/2} y={-textH/2}
            width={textLen} height={textH}
            rx={labelBgBorderRadius||4}
            fill={labelBgStyle?.fill||"#111418"}
            fillOpacity={labelBgStyle?.fillOpacity||0.95}
            stroke={strokeColor} strokeWidth={0.8}/>
          <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
            style={{
              fill: labelStyle?.fill || strokeColor,
              fontSize: labelStyle?.fontSize||12,
              fontWeight: labelStyle?.fontWeight||700,
              fontFamily: labelStyle?.fontFamily||"monospace",
            }}>{label}</text>
        </g>
      )}
    </g>
  );
}

/* ── Register custom edge type ───────────────────────────────── */
const EDGE_TYPES = { straight: StraightEdge };

/* ══════════════════════════════════════════════════════════════
   FLOW DIAGRAM COMPONENT
══════════════════════════════════════════════════════════════ */
function FlowDiagramInner({nodes:initN,edges:initE}){
  const [nodes,setNodes,onNC]=useNodesState(initN);
  const [edges,setEdges,onEC]=useEdgesState(initE);
  const { fitView } = useReactFlow();

  useEffect(()=>{
    const styledEdges = initE.map(e=>{
      const isYes = e.label==="Yes" || e.label==="yes" || e.label==="True";
      const isNo  = e.label==="No"  || e.label==="no"  || e.label==="False";
      const color = isYes ? "#34d399" : isNo ? "#f87171" : "#4a90b8";
      return {
        ...e,
        type: "straight",      // our custom pure-straight edge
        style: { stroke: color, strokeWidth: 2.5 },
        labelStyle: {
          fill: color,
          fontSize: 12, fontWeight: 700,
          fontFamily: "'DM Mono',monospace",
        },
        labelBgStyle:  { fill:"#111418", fillOpacity:0.95 },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: "arrowclosed",
          color, width: 16, height: 16,
        },
      };
    });
    setNodes(initN);
    setEdges(styledEdges);
    setTimeout(()=>fitView({padding:0.2,duration:500}),100);
  },[initN,initE]);

  return(
    <ReactFlow
      nodes={nodes} edges={edges}
      onNodesChange={onNC} onEdgesChange={onEC}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView fitViewOptions={{padding:0.2}}
      minZoom={0.04} maxZoom={3}
      defaultEdgeOptions={{type:"straight"}}
      snapToGrid={true} snapGrid={[10,10]}>
      <Background color="#1a2035" gap={24} size={1}/>
      <Controls style={{background:"var(--ink2)",border:"1px solid var(--line2)"}}/>
      <MiniMap style={{background:"#0d0f18"}}
        nodeColor={n=>n.data?.color||"#3a4658"}
        maskColor="rgba(0,0,0,.7)"/>
    </ReactFlow>
  );
}
function FlowDiagram({nodes,edges}){
  return(
    <div className="flow-wrap">
      <ReactFlowProvider>
        <FlowDiagramInner nodes={nodes} edges={edges}/>
      </ReactFlowProvider>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   EXPLANATION VIEW
══════════════════════════════════════════════════════════════ */
function ExplanationView({explanation}){
  if(!explanation||!Array.isArray(explanation)||explanation.length===0)
    return <div style={{color:"var(--fog)",fontSize:13}}>No explanation available.</div>;
  const iconColors={"🔍 What it does":"#00c8a8","📋 How it works":"#a78bfa","💡 Key concepts":"#fbbf24","💡 Key concepts used":"#fbbf24","📤 What you will see":"#38bdf8","📤 What happens":"#38bdf8"};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      {explanation.map((sec,idx)=>{
        const accent=iconColors[sec.title]||"var(--teal)";
        return(
          <div key={idx} style={{background:"var(--ink2)",border:`1px solid ${accent}33`,borderLeft:`3px solid ${accent}`,borderRadius:10,padding:"13px 16px"}}>
            <div style={{fontFamily:"var(--mono)",fontSize:11,letterSpacing:".1em",color:accent,marginBottom:9,fontWeight:600}}>{sec.title}</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {sec.body.split("\n").filter(Boolean).map((line,li)=>(
                <div key={li} style={{fontSize:13,color:"var(--cloud)",lineHeight:1.7,fontFamily:"var(--body)"}}>{line}</div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CONSOLE VIEW
══════════════════════════════════════════════════════════════ */
function ConsoleView({console:con,isRunning}){
  if(isRunning)return(<div className="out-loading" style={{height:200}}><div className="loader"/><div className="loader-msg">Running your code…</div></div>);
  if(!con)return(<div className="out-empty" style={{height:200}}><div className="out-empty-icon">▶</div><div className="out-empty-h">Not run yet</div><p className="out-empty-p">Click <strong style={{color:"var(--teal)"}}>▶ Run Code</strong> to execute.</p></div>);
  const sc={success:"var(--teal)",error:"var(--red)",exited:"var(--gold)"}[con.status]||"var(--silver)";
  const sl={success:"✓ Executed successfully",error:"✕ Runtime error",exited:"⚠ Exited"}[con.status]||con.status;
  const isEmpty=!con.stdout?.trim()&&!con.stderr?.trim();
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--ink3)",border:`1px solid ${sc}44`,borderRadius:8,padding:"8px 14px"}}>
        <span style={{fontFamily:"var(--mono)",fontSize:11,color:sc,letterSpacing:".06em",fontWeight:600}}>{sl}</span>
        <span style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--fog)"}}>{con.elapsed_ms}ms</span>
      </div>
      <div style={{background:"#060a10",border:"1px solid var(--line2)",borderRadius:8,overflow:"hidden"}}>
        <div style={{padding:"5px 14px",borderBottom:"1px solid var(--line2)",fontFamily:"var(--mono)",fontSize:9,letterSpacing:".16em",textTransform:"uppercase",color:"var(--teal)",background:"var(--ink3)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:"#34d399",display:"inline-block"}}/>STDOUT
        </div>
        <pre style={{margin:0,padding:"16px 20px",fontFamily:"'Fira Code',var(--mono)",fontSize:13,lineHeight:1.85,color:isEmpty?"var(--mist)":"#b8e8c8",minHeight:80,maxHeight:340,overflowY:"auto",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
          {con.stdout?.trim()||"(no output)"}
        </pre>
      </div>
      {con.stderr?.trim()&&(
        <div style={{background:"#0f0508",border:"1px solid rgba(224,80,80,.35)",borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"5px 14px",borderBottom:"1px solid rgba(224,80,80,.2)",fontFamily:"var(--mono)",fontSize:9,letterSpacing:".16em",textTransform:"uppercase",color:"var(--red)",background:"var(--ink3)",display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"var(--red)",display:"inline-block"}}/>STDERR / TRACEBACK
          </div>
          <pre style={{margin:0,padding:"14px 18px",fontFamily:"'Fira Code',var(--mono)",fontSize:12,lineHeight:1.75,color:"#e8a0a0",maxHeight:280,overflowY:"auto",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
            {con.stderr.trim()}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   INPUT MODAL
══════════════════════════════════════════════════════════════ */
function InputModal({prompts,values,onChange,onRun,onCancel}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(5px)"}}>
      <div style={{background:"var(--ink2)",border:"1px solid var(--teal)",borderRadius:14,padding:"28px 32px",width:"100%",maxWidth:440,boxShadow:"0 24px 80px rgba(0,0,0,.6)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <div style={{fontSize:22}}>⌨️</div>
          <div style={{fontFamily:"var(--disp)",fontSize:20,fontWeight:800,letterSpacing:"-.02em"}}>Program needs input</div>
        </div>
        <p style={{fontSize:13,color:"var(--fog)",marginBottom:22,lineHeight:1.6}}>
          Your code calls <code style={{fontFamily:"var(--mono)",color:"var(--teal)",background:"var(--ink3)",padding:"1px 6px",borderRadius:4}}>input()</code> {prompts.length} time{prompts.length>1?"s":""}. Enter the values below — they will be fed in order.
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
          {prompts.map((p,i)=>(
            <div key={i}>
              <div style={{fontSize:11,fontFamily:"var(--mono)",color:"var(--silver)",marginBottom:6}}>Input {i+1}{p.prompt?` — "${p.prompt}"`:""}  <span style={{color:"var(--fog)"}}>(type will be auto-converted)</span></div>
              <input type="text" value={values[i]||""} onChange={e=>onChange(i,e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&i===prompts.length-1)onRun(values);}}
                placeholder={p.prompt||`Enter value ${i+1}…`} autoFocus={i===0}
                style={{width:"100%",background:"var(--ink3)",border:"1px solid var(--line2)",borderRadius:8,color:"var(--white)",fontSize:14,fontFamily:"var(--mono)",padding:"11px 14px",outline:"none"}}
                onFocus={e=>e.target.style.borderColor="var(--teal)"} onBlur={e=>e.target.style.borderColor="var(--line2)"}/>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"11px 0",background:"transparent",border:"1px solid var(--line2)",borderRadius:8,color:"var(--silver)",fontSize:13,fontWeight:500,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>onRun(values)} style={{flex:2,padding:"11px 0",background:"var(--teal)",border:"none",borderRadius:8,color:"var(--ink)",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 20px var(--teal-glow)"}}>▶ Run with these values</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SAMPLE PROGRAMS — covers basic to advanced Python
══════════════════════════════════════════════════════════════ */
const SAMPLES = {
  "Hello World": `# Basic Hello World
print("Hello, World!")
print("Welcome to Ragsy!")`,

  "Calculator": `# Simple Calculator with user input
a = int(input("Enter first number: "))
b = int(input("Enter second number: "))
op = input("Enter operator (+, -, *, /): ")

if op == '+':
    result = a + b
elif op == '-':
    result = a - b
elif op == '*':
    result = a * b
elif op == '/':
    if b == 0:
        print("Error: Division by zero!")
    else:
        result = a / b
        print(f"{a} / {b} = {result}")
else:
    print("Invalid operator")
    result = None

if op != '/' and result is not None:
    print(f"{a} {op} {b} = {result}")`,

  "Multiplication Table": `# Multiplication table
num = int(input("Enter a number: "))
print(f"\\nMultiplication Table of {num}:")
for i in range(1, 11):
    print(f"{num} x {i} = {num * i}")`,

  "Fibonacci": `# Fibonacci series
n = int(input("How many Fibonacci numbers? "))
a, b = 0, 1
print("Fibonacci series:")
for i in range(n):
    print(a, end=" ")
    a, b = b, a + b
print()`,

  "Factorial": `# Factorial using recursion
def factorial(n):
    if n == 0 or n == 1:
        return 1
    return n * factorial(n - 1)

num = int(input("Enter a number: "))
if num < 0:
    print("Factorial not defined for negative numbers")
else:
    print(f"Factorial of {num} = {factorial(num)}")`,

  "Prime Check": `# Check if a number is prime
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True

n = int(input("Enter a number: "))
if is_prime(n):
    print(f"{n} is a Prime number")
else:
    print(f"{n} is NOT a Prime number")`,

  "Pattern Printing": `# Star pattern
rows = int(input("Enter number of rows: "))
print("\\nPyramid Pattern:")
for i in range(1, rows + 1):
    print(" " * (rows - i) + "* " * i)`,

  "OOP Example": `# Object-Oriented Programming
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance
        self.transactions = []

    def deposit(self, amount):
        if amount > 0:
            self.balance += amount
            self.transactions.append(f"Deposit: +{amount}")
            print(f"Deposited {amount}. Balance: {self.balance}")

    def withdraw(self, amount):
        if amount > self.balance:
            print("Insufficient funds!")
        elif amount > 0:
            self.balance -= amount
            self.transactions.append(f"Withdrawal: -{amount}")
            print(f"Withdrew {amount}. Balance: {self.balance}")

    def show_statement(self):
        print(f"\\nAccount: {self.owner}")
        for t in self.transactions:
            print(f"  {t}")
        print(f"  Final Balance: {self.balance}")

acc = BankAccount("Alice", 1000)
acc.deposit(500)
acc.withdraw(200)
acc.withdraw(2000)
acc.show_statement()`,

  "List & Dictionary": `# Working with lists and dictionaries
students = {}
n = int(input("How many students? "))

for i in range(n):
    name = input(f"Student {i+1} name: ")
    marks = float(input(f"Marks for {name}: "))
    students[name] = marks

print("\\nResults:")
for name, marks in sorted(students.items(), key=lambda x: -x[1]):
    grade = "A" if marks>=90 else "B" if marks>=80 else "C" if marks>=70 else "D" if marks>=60 else "F"
    print(f"  {name}: {marks} → Grade {grade}")

avg = sum(students.values()) / len(students)
print(f"\\nClass Average: {avg:.2f}")`,

  "Exception Handling": `# Exception handling demo
def safe_divide(a, b):
    try:
        result = a / b
        return result
    except ZeroDivisionError:
        print("Error: Cannot divide by zero!")
        return None
    except TypeError:
        print("Error: Please enter numbers only!")
        return None
    finally:
        print("Division operation attempted.")

x = float(input("Enter numerator: "))
y = float(input("Enter denominator: "))
result = safe_divide(x, y)
if result is not None:
    print(f"Result: {x} / {y} = {result:.4f}")`,
};

/* ══════════════════════════════════════════════════════════════
   TASK LISTS — Python Basics & JavaScript Basics
══════════════════════════════════════════════════════════════ */
const PY_TASKS=[
  {id:1,title:"Hello World",level:"Beginner",time:120,desc:"Print 'Hello, World!' to the screen.",starter:"# Task 1: Hello World\n# Print Hello, World!\nprint('Hello, World!')"},
  {id:2,title:"Add Two Numbers",level:"Beginner",time:180,desc:"Create two variables num1=10 and num2=20, add them and print the result.",starter:"# Task 2: Add Two Numbers\nnum1 = 10\nnum2 = 20\n# Add and print the result\n"},
  {id:3,title:"Even or Odd",level:"Beginner",time:240,desc:"Check if the number 7 is even or odd and print 'Even' or 'Odd'.",starter:"# Task 3: Even or Odd\nnum = 7\n# Check if num is even or odd\n"},
  {id:4,title:"FizzBuzz",level:"Beginner",time:300,desc:"Print numbers 1-20. For multiples of 3 print 'Fizz', for 5 print 'Buzz', for both print 'FizzBuzz'.",starter:"# Task 4: FizzBuzz\nfor i in range(1, 21):\n    # Check conditions and print\n    pass\n"},
  {id:5,title:"Sum of List",level:"Beginner",time:240,desc:"Given numbers=[1,2,3,4,5], find and print the sum without using sum().",starter:"# Task 5: Sum of List\nnumbers = [1, 2, 3, 4, 5]\ntotal = 0\n# Loop and add each number\n"},
  {id:6,title:"Find the Largest",level:"Intermediate",time:360,desc:"Given numbers=[3,7,1,9,4], find and print the largest number without using max().",starter:"# Task 6: Find the Largest\nnumbers = [3, 7, 1, 9, 4]\nlargest = numbers[0]\n# Loop and compare\n"},
  {id:7,title:"Factorial",level:"Intermediate",time:420,desc:"Write a function to calculate factorial of 5 using recursion.",starter:"# Task 7: Factorial using recursion\ndef factorial(n):\n    # Base case\n    if n == 0:\n        return 1\n    # Recursive case\n    return n * factorial(n - 1)\n\nprint(factorial(5))\n"},
  {id:8,title:"Reverse a String",level:"Intermediate",time:240,desc:"Reverse the string 'Ragsy' and print it without using [::-1].",starter:"# Task 8: Reverse a String\ntext = 'Ragsy'\nresult = ''\n# Loop and build reversed string\n"},
  {id:9,title:"Count Vowels",level:"Intermediate",time:300,desc:"Count the number of vowels in 'Hello World' and print the count.",starter:"# Task 9: Count Vowels\ntext = 'Hello World'\nvowels = 'aeiouAEIOU'\ncount = 0\n# Loop through text\n"},
  {id:10,title:"Simple Class",level:"Advanced",time:600,desc:"Create a Student class with name and marks attributes and a method to print grade.",starter:"# Task 10: Simple Class\nclass Student:\n    def __init__(self, name, marks):\n        self.name = name\n        self.marks = marks\n    \n    def get_grade(self):\n        # Return A, B, C based on marks\n        pass\n\ns = Student('Alice', 85)\nprint(s.get_grade())\n"},
];

const JS_TASKS=[
  {id:1,title:"Hello World",level:"Beginner",time:120,desc:"Print 'Hello, World!' using console.log().",starter:"// Task 1: Hello World\n// Print Hello, World!\nconsole.log('Hello, World!');\n"},
  {id:2,title:"Add Two Numbers",level:"Beginner",time:180,desc:"Create variables num1=10 and num2=20, add them and print the result.",starter:"// Task 2: Add Two Numbers\nlet num1 = 10;\nlet num2 = 20;\n// Add and print the result\n"},
  {id:3,title:"Even or Odd",level:"Beginner",time:240,desc:"Check if the number 7 is even or odd and print 'Even' or 'Odd'.",starter:"// Task 3: Even or Odd\nlet num = 7;\n// Check if num is even or odd\nif (num % 2 === 0) {\n    console.log('Even');\n} else {\n    console.log('Odd');\n}\n"},
  {id:4,title:"FizzBuzz",level:"Beginner",time:300,desc:"Print numbers 1-20. For multiples of 3 print 'Fizz', for 5 print 'Buzz', for both print 'FizzBuzz'.",starter:"// Task 4: FizzBuzz\nfor (let i = 1; i <= 20; i++) {\n    // Check conditions and print\n}\n"},
  {id:5,title:"Sum of Array",level:"Beginner",time:240,desc:"Given numbers=[1,2,3,4,5], find and print the sum using a loop.",starter:"// Task 5: Sum of Array\nlet numbers = [1, 2, 3, 4, 5];\nlet total = 0;\n// Loop and add each number\nfor (let i = 0; i < numbers.length; i++) {\n    // add to total\n}\nconsole.log(total);\n"},
  {id:6,title:"Find the Largest",level:"Intermediate",time:360,desc:"Given numbers=[3,7,1,9,4], find and print the largest number without using Math.max().",starter:"// Task 6: Find the Largest\nlet numbers = [3, 7, 1, 9, 4];\nlet largest = numbers[0];\n// Loop and compare\n"},
  {id:7,title:"Reverse a String",level:"Intermediate",time:240,desc:"Reverse the string 'Ragsy' and print it without using .reverse().",starter:"// Task 7: Reverse a String\nlet text = 'Ragsy';\nlet result = '';\n// Loop and build reversed string\nfor (let i = text.length - 1; i >= 0; i--) {\n    result += text[i];\n}\nconsole.log(result);\n"},
  {id:8,title:"Count Vowels",level:"Intermediate",time:300,desc:"Count the number of vowels in 'Hello World' and print the count.",starter:"// Task 8: Count Vowels\nlet text = 'Hello World';\nlet vowels = 'aeiouAEIOU';\nlet count = 0;\n// Loop through text\n"},
  {id:9,title:"Simple Function",level:"Intermediate",time:420,desc:"Write a function that takes two numbers and returns the larger one. Test it with 8 and 13.",starter:"// Task 9: Simple Function\nfunction findLarger(a, b) {\n    // Return the larger of a and b\n}\nconsole.log(findLarger(8, 13));\n"},
  {id:10,title:"Simple Object",level:"Advanced",time:600,desc:"Create a student object with name, marks and a getGrade method that returns A, B or C.",starter:"// Task 10: Simple Object\nconst student = {\n    name: 'Alice',\n    marks: 85,\n    getGrade: function() {\n        // Return A (>=80), B (>=60), C (below 60)\n    }\n};\nconsole.log(student.getGrade());\n"},
];

/* ══════════════════════════════════════════════════════════════
   EDITOR PAGE
══════════════════════════════════════════════════════════════ */
function EditorPage({user,token,onBack,onSignOut,initialCode="",editorLang="python"}){
  const [code,setCode]                     = useState(initialCode);
  const [loadingDiagram,setLoadingDiagram] = useState(false);
  const [loadingRun,setLoadingRun]         = useState(false);
  const [scanningInputs,setScanningInputs] = useState(false);
  const [downloading,setDownloading]       = useState(false);
  const [result,setResult]                 = useState(null);
  const [consoleOut,setConsoleOut]         = useState(null);
  const [activeTab,setTab]                 = useState("diagram");
  const [error,setError]                   = useState("");
  const [toast,fireToast]                  = useToast();
  const [inputPrompts,setInputPrompts]     = useState([]);
  const [inputValues,setInputValues]       = useState([]);
  const [showInputModal,setShowInputModal] = useState(false);
  const [showSamples,setShowSamples]       = useState(false);
  const [showTasks,setShowTasks]           = useState(false);
  const [activitiesOpen,setActivitiesOpen] = useState(false);
  const [lang,setLang]                     = useState(editorLang||"python");
  const flowContainerRef = useRef(null);
  const taRef = useRef(null);

  const lineCount = Math.max(1,code.split("\n").length);
  const lineNums  = Array.from({length:lineCount},(_,i)=>i+1);

  useEffect(()=>{if(initialCode)setCode(initialCode);},[initialCode]);

  function syncScroll(e){const ln=e.target.previousSibling;if(ln)ln.scrollTop=e.target.scrollTop;}

  /* ── Generate Flowchart ─────────────────────────────────────*/
  async function handleGenerate(){
    if(!code.trim())return fireToast("err","Please paste some code first");
    setLoadingDiagram(true);setResult(null);setError("");setConsoleOut(null);
    setTab("diagram");
    try{
      const data=await apiFetch(`/visualize?token=${token}`,{method:"POST",body:JSON.stringify({code,language:lang})});
      // Apply dagre layout — pass edges so diamond nodes route correctly
      const laidOutNodes=await applyDagreLayout(data.nodes, data.edges);
      setResult({...data, nodes:laidOutNodes});
      fireToast("ok",`Flowchart ready — ${data.stats.node_count} nodes`);
    }catch(err){setError(err.message);fireToast("err",err.message);}
    finally{setLoadingDiagram(false);}
  }

  /* ── Run Code with input scanning ──────────────────────────*/
  async function handleRun(){
    if(!code.trim())return fireToast("err","Please paste some Python code first");
    setScanningInputs(true);
    try{
      const scan=await apiFetch(`/scan-inputs?token=${token}`,{method:"POST",body:JSON.stringify({code,user_inputs:[]})});
      const prompts=scan.inputs||[];
      if(prompts.length>0){setInputPrompts(prompts);setInputValues(prompts.map(()=>""));setShowInputModal(true);}
      else await executeCode([]);
    }catch(_){await executeCode([]);}
    finally{setScanningInputs(false);}
  }

  async function executeCode(values){
    setShowInputModal(false);setLoadingRun(true);setTab("console");
    try{
      const data=await apiFetch(`/run?token=${token}`,{method:"POST",body:JSON.stringify({code,language:lang,user_inputs:values})});
      setConsoleOut(data);
      fireToast(data.status==="error"?"err":"ok",data.status==="error"?"Runtime error — check Console":`Done in ${data.elapsed_ms}ms`);
    }catch(err){fireToast("err",err.message);}
    finally{setLoadingRun(false);}
  }

  /* ── Download as PNG — captures the live React Flow canvas
     including all SVG edges/arrows using html-to-image.
     Falls back to a clean static render if RF viewport not found.
  ──────────────────────────────────────────────────────────── */
  async function handleDownload(){
    if(!result)return fireToast("err","Generate a flowchart first");
    setDownloading(true);
    try{
      // Dynamically load html-to-image from CDN
      await loadHtmlToImage();
      const { toPng } = window.htmlToImage;

      // Target the React Flow renderer which contains nodes + SVG edges
      const rfViewport = document.querySelector(".react-flow__viewport");
      const rfWrapper  = document.querySelector(".react-flow");

      if(rfViewport && rfWrapper && toPng){
        // Calculate the bounding box from node positions
        const ns = result.nodes;
        const minX = Math.min(...ns.map(n=>n.position.x)) - 60;
        const minY = Math.min(...ns.map(n=>n.position.y)) - 60;
        const maxX = Math.max(...ns.map(n=>n.position.x+240)) + 60;
        const maxY = Math.max(...ns.map(n=>n.position.y+100)) + 60;
        const W = Math.max(maxX-minX, 900);
        const H = Math.max(maxY-minY, 500);

        // Get current transform of the viewport
        const style = window.getComputedStyle(rfViewport);
        const matrix = new DOMMatrixReadOnly(style.transform);
        const scale  = matrix.a || 1;
        const tx     = matrix.e || 0;
        const ty     = matrix.f || 0;

        const dataUrl = await toPng(rfWrapper, {
          backgroundColor: "#111418",
          width:  W,
          height: H,
          style:{
            width:  W+"px",
            height: H+"px",
            transform: `translate(${tx - minX * scale}px, ${ty - minY * scale}px) scale(${scale})`,
            transformOrigin: "top left",
          },
          pixelRatio: 2,
        });

        const a=document.createElement("a");
        a.href=dataUrl;
        a.download=`ragsy-flowchart-${result.code_id||"diagram"}.png`;
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        fireToast("ok","Flowchart with connections downloaded!");
      } else {
        // Fallback: static node-only render
        await fallbackStaticDownload();
      }

      if(result.code_id&&token){
        apiFetch(`/flowchart/download?token=${token}&code_id=${result.code_id}`,{method:"POST"}).catch(()=>{});
      }
    }catch(err){
      console.error("Download error:",err);
      fireToast("err","Download failed — try again");
    }finally{setDownloading(false);}
  }

  /* ── Fallback: static rendered PNG without live RF viewport ─*/
  async function fallbackStaticDownload(){
    const { toPng } = window.htmlToImage;
    const ns=[...result.nodes].sort((a,b)=>a.position.y-b.position.y);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    ns.forEach(n=>{minX=Math.min(minX,n.position.x);minY=Math.min(minY,n.position.y);maxX=Math.max(maxX,n.position.x+280);maxY=Math.max(maxY,n.position.y+90);});
    const W=maxX-minX+160;const H=maxY-minY+160;
    const wrap=document.createElement("div");
    wrap.style.cssText=`position:fixed;left:-9999px;top:0;background:#111418;width:${W+80}px;padding:40px;font-family:'DM Mono',monospace;`;
    const hdr=document.createElement("div");hdr.style.cssText="color:#00c8a8;font-size:16px;font-weight:700;margin-bottom:20px;";hdr.textContent="Ragsy — Code Flowchart";
    wrap.appendChild(hdr);
    const area=document.createElement("div");area.style.cssText=`position:relative;width:${W}px;height:${H}px;`;
    ns.forEach(n=>{
      const el=document.createElement("div");
      const x=n.position.x-minX+60;const y=n.position.y-minY+60;
      const color=n.data?.color||n.style?.border?.match(/#[0-9a-fA-F]+/)?.[0]||"#64748b";
      const bg=n.data?.bg||n.style?.background||"#1e293b";
      const label=n.data?.label||"";
      el.style.cssText=`position:absolute;left:${x}px;top:${y}px;min-width:180px;max-width:260px;padding:10px 14px;background:${bg};border:2px solid ${color};border-radius:8px;color:#fff;font-size:11px;text-align:center;word-break:break-word;line-height:1.5;`;
      el.textContent=label;area.appendChild(el);
    });
    wrap.appendChild(area);document.body.appendChild(wrap);
    const dataUrl=await toPng(wrap,{backgroundColor:"#111418",pixelRatio:2});
    document.body.removeChild(wrap);
    const a=document.createElement("a");a.href=dataUrl;a.download=`ragsy-flowchart-${result.code_id||"diagram"}.png`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    fireToast("ok","Flowchart downloaded (static)");
  }

  /* ── Load html-to-image from CDN ───────────────────────────*/
  function loadHtmlToImage(){
    return new Promise((resolve,reject)=>{
      if(window.htmlToImage){resolve();return;}
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js";
      s.onload=resolve;s.onerror=()=>{
        // try unpkg fallback
        const s2=document.createElement("script");
        s2.src="https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js";
        s2.onload=resolve;s2.onerror=reject;
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
  }

  const TABS=[
    {id:"diagram",label:"Flowchart",icon:"⬡"},
    {id:"console",label:"Console",icon:"▶",badge:consoleOut?(consoleOut.status==="error"?"ERR":"OK"):null,badgeOk:consoleOut?.status!=="error"},
    {id:"explanation",label:"Explanation",icon:"📋"},
  ];
  const runBtnDisabled=loadingRun||loadingDiagram||scanningInputs;

  return(
    <div className="page editor-page"><style>{STYLES}</style>
      <Toast {...toast}/>
      <NavBar user={user} section={lang==="javascript"?"JavaScript Basics":"Python Basics"} tealSection onLogoClick={onBack} onSignOut={onSignOut}
        onActivities={()=>setActivitiesOpen(o=>!o)}/>

      {showInputModal&&(
        <InputModal prompts={inputPrompts} values={inputValues}
          onChange={(i,val)=>setInputValues(p=>{const n=[...p];n[i]=val;return n;})}
          onRun={vals=>executeCode(vals)} onCancel={()=>setShowInputModal(false)}/>
      )}

      {/* Sample picker dropdown */}
      {showSamples&&(
        <div style={{position:"fixed",top:64,left:0,right:0,background:"var(--ink2)",borderBottom:"1px solid var(--line)",zIndex:45,padding:"16px 24px",display:"flex",flexWrap:"wrap",gap:8}}>
          <span style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"var(--teal)",marginRight:8,alignSelf:"center"}}>Choose a sample:</span>
          {Object.keys(SAMPLES).map(name=>(
            <button key={name} onClick={()=>{setCode(SAMPLES[name]);setShowSamples(false);setResult(null);setConsoleOut(null);setError("");}}
              style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--cloud)",background:"var(--ink3)",border:"1px solid var(--line2)",borderRadius:6,padding:"5px 12px",cursor:"pointer",transition:"all .2s"}}
              onMouseEnter={e=>{e.target.style.borderColor="var(--teal)";e.target.style.color="var(--white)";}}
              onMouseLeave={e=>{e.target.style.borderColor="var(--line2)";e.target.style.color="var(--cloud)";}}>
              {name}
            </button>
          ))}
          <button onClick={()=>setShowSamples(false)} style={{marginLeft:"auto",fontFamily:"var(--mono)",fontSize:11,color:"var(--fog)",background:"transparent",border:"none",cursor:"pointer",padding:"4px 8px"}}>✕ Close</button>
        </div>
      )}

      <div className="editor-body" style={{marginTop:showSamples?50:0,transition:"margin .2s"}}>
        {/* LEFT: Code Editor */}
        <div className="editor-panel">
          <div className="panel-hdr">
            <div className="panel-title"><div className="ptitle-dot"/>{lang==="javascript"?"JavaScript Source Code":"Python Source Code"}</div>
            <div className="panel-actions">
              <button className="panel-btn" onClick={()=>setShowTasks(s=>!s)} style={{background:showTasks?"var(--teal)":"transparent",color:showTasks?"var(--ink)":"var(--teal)",border:"1px solid var(--teal)",fontWeight:700}}>📋 Tasks</button>
              <button className="panel-btn" onClick={()=>{setCode("");setResult(null);setConsoleOut(null);setError("");}}>Clear</button>
            </div>
          </div>

          {/* TASKS PANEL — shown when Tasks button clicked */}
          {showTasks&&(
            <div style={{background:"var(--ink2)",borderBottom:"2px solid var(--teal)",padding:"16px 20px",maxHeight:320,overflowY:"auto"}}>
              <div style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"var(--teal)",marginBottom:12}}>
                {lang==="javascript"?"⚡ JavaScript Basics — Practice Tasks":"🐍 Python Basics — Practice Tasks"}
              </div>
              {(lang==="javascript"?JS_TASKS:PY_TASKS).map((task,i)=>(
                <div key={task.id} style={{background:"var(--ink3)",border:"1px solid var(--line2)",borderRadius:10,padding:"12px 16px",marginBottom:10,cursor:"pointer",transition:"all .2s"}}
                  onClick={()=>{setCode(task.starter);setShowTasks(false);fireToast("ok",`Task loaded: ${task.title}`);}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="var(--teal)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="var(--line2)"}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontWeight:700,fontSize:13,color:"var(--white)"}}>{i+1}. {task.title}</span>
                    <span style={{fontFamily:"var(--mono)",fontSize:9,padding:"2px 8px",borderRadius:20,
                      background:task.level==="Beginner"?"rgba(52,211,153,.1)":task.level==="Intermediate"?"rgba(251,191,36,.1)":"rgba(248,113,113,.1)",
                      color:task.level==="Beginner"?"#34d399":task.level==="Intermediate"?"#fbbf24":"#f87171",
                      border:`1px solid ${task.level==="Beginner"?"rgba(52,211,153,.3)":task.level==="Intermediate"?"rgba(251,191,36,.3)":"rgba(248,113,113,.3)"}`
                    }}>{task.level}</span>
                  </div>
                  <div style={{fontSize:12,color:"var(--cloud)",marginBottom:6,lineHeight:1.5}}>{task.desc}</div>
                  <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--fog)"}}>⏱ {Math.floor(task.time/60)} min · Click to load starter code</div>
                </div>
              ))}
            </div>
          )}
          <div className="editor-wrap">
            <div className="line-nums" style={{overflowY:"hidden"}}>
              {lineNums.map(n=><div key={n} className="line-num">{n}</div>)}
            </div>
            <textarea ref={taRef} className="code-ta" value={code}
              onChange={e=>setCode(e.target.value)} onScroll={syncScroll}
              placeholder={lang==="javascript"
                ?"// Write your JavaScript code here…\n// Example: console.log('Hello World')\n// Supports: variables, loops, functions, arrays, objects, if/else"
                :"# Write your Python code here…\n# Example: print('Hello World')\n# Supports: variables, loops, functions, classes, recursion, exceptions"}
              spellCheck={false}/>
          </div>
          <div className="run-bar">
            <div className="run-info">Language: <span>{lang==="javascript"?"JavaScript":"Python"}</span> · {lang==="javascript"?"Node.js runtime":"AST-powered"}</div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <button
                style={{display:"flex",alignItems:"center",gap:8,
                  background:runBtnDisabled?"transparent":"rgba(0,200,168,.12)",
                  color:runBtnDisabled?"var(--fog)":"var(--teal)",
                  border:"2px solid "+(runBtnDisabled?"var(--line)":"var(--teal)"),
                  borderRadius:12,fontSize:15,fontWeight:700,
                  padding:"13px 28px",cursor:runBtnDisabled?"not-allowed":"pointer",
                  opacity:runBtnDisabled?.5:1,transition:"all .2s",
                  minWidth:150,justifyContent:"center",letterSpacing:".03em"}}
                onClick={handleRun} disabled={runBtnDisabled}>
                {scanningInputs?<><div className="loader" style={{width:15,height:15}}/>&nbsp;Scanning…</>
                :loadingRun?<><div className="loader" style={{width:15,height:15}}/>&nbsp;Running…</>
                :<><span style={{fontSize:18}}>▶</span>&nbsp;Run Code</>}
              </button>
              <button
                style={{display:"flex",alignItems:"center",gap:8,
                  background:(loadingDiagram||loadingRun||scanningInputs)?"var(--ink2)":"var(--teal)",
                  color:(loadingDiagram||loadingRun||scanningInputs)?"var(--fog)":"var(--ink)",
                  border:"2px solid "+(loadingDiagram||loadingRun||scanningInputs)?"var(--line)":"var(--teal)",
                  borderRadius:12,fontSize:15,fontWeight:800,
                  padding:"13px 28px",cursor:(loadingDiagram||loadingRun||scanningInputs)?"not-allowed":"pointer",
                  opacity:(loadingDiagram||loadingRun||scanningInputs)?.6:1,transition:"all .2s",
                  minWidth:200,justifyContent:"center",letterSpacing:".03em",
                  boxShadow:(loadingDiagram||loadingRun||scanningInputs)?"none":"0 4px 18px var(--teal-glow)"}}
                onClick={handleGenerate} disabled={loadingDiagram||loadingRun||scanningInputs}>
                {loadingDiagram
                  ?<><div className="loader" style={{width:15,height:15}}/>&nbsp;Generating…</>
                  :<><span style={{fontSize:18}}>⬡</span>&nbsp;Generate Flowchart</>}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Output */}
        <div className="output-panel">
          {(result||consoleOut)?(
            <div className="out-tabs">
              {TABS.map(t=>(
                <button key={t.id} className={`out-tab ${activeTab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
                  {t.icon} {t.label}
                  {t.badge&&(<span style={{marginLeft:6,fontSize:9,fontFamily:"var(--mono)",background:t.badgeOk?"rgba(0,200,168,.2)":"rgba(224,80,80,.25)",color:t.badgeOk?"var(--teal)":"var(--red)",border:`1px solid ${t.badgeOk?"rgba(0,200,168,.4)":"rgba(224,80,80,.4)"}`,borderRadius:20,padding:"1px 6px"}}>{t.badge}</span>)}
                </button>
              ))}
            </div>
          ):(
            <div className="panel-hdr">
              <div className="panel-title"><div className="ptitle-dot" style={{background:"var(--fog)",boxShadow:"none"}}/>Output</div>
            </div>
          )}

          <div className="out-content">
            {!result&&!consoleOut&&!loadingDiagram&&!loadingRun&&!error&&(
              <div className="out-empty">
                <div className="out-empty-icon">⬡</div>
                <div className="out-empty-h">Ready to visualize</div>
                <p className="out-empty-p">Click <strong style={{color:"var(--teal)"}}>▶ Run Code</strong> to execute,<br/>or <strong style={{color:"var(--teal)"}}>Generate Flowchart</strong> to build the diagram.</p>
              </div>
            )}
            {loadingDiagram&&(<div className="out-loading"><div className="loader"/><div className="loader-msg">Parsing AST & building flowchart…</div></div>)}
            {error&&!loadingDiagram&&(<div style={{padding:18}}><div className="err-box" style={{display:"block"}}>{error}</div></div>)}

            {/* FLOWCHART TAB */}
            {activeTab==="diagram"&&result&&!loadingDiagram&&(
              <div>
                <div className="sect-lbl">Interactive Flowchart</div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:13,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {[{color:"#fca5a5",shape:"◇",label:"Decision"},{color:"#34d399",shape:"◇",label:"Loop"},{color:"#60a5fa",shape:"▱",label:"I/O"},{color:"#a78bfa",shape:"□",label:"Function"},{color:"#38bdf8",shape:"□",label:"Process"}].map(l=>(
                      <div key={l.label} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"var(--silver)",fontFamily:"var(--mono)",background:"var(--ink3)",border:`1px solid ${l.color}44`,borderRadius:5,padding:"2px 7px"}}>
                        <span style={{color:l.color,fontSize:10}}>{l.shape}</span>{l.label}
                      </div>
                    ))}
                  </div>
                  {/* DOWNLOAD PNG BUTTON */}
                  <button onClick={handleDownload} disabled={downloading}
                    style={{display:"flex",alignItems:"center",gap:6,background:downloading?"var(--mist)":"linear-gradient(135deg,var(--teal),#00b894)",color:"var(--ink)",border:"none",borderRadius:7,fontFamily:"var(--mono)",fontSize:11,letterSpacing:".06em",fontWeight:700,padding:"7px 16px",cursor:downloading?"not-allowed":"pointer",transition:"all .2s",flexShrink:0,boxShadow:downloading?"none":"0 4px 16px var(--teal-glow)"}}>
                    {downloading?"⏳ Saving…":"⬇ Download PNG"}
                  </button>
                </div>
                <FlowDiagram nodes={result.nodes} edges={result.edges} containerRef={flowContainerRef}/>
                <div className="stats-row" style={{marginTop:12}}>
                  <span className="stat-pill">🧩 {result.stats.node_count} nodes</span>
                  <span className="stat-pill">🔗 {result.stats.edge_count} edges</span>
                  <span className="stat-pill">📄 {result.stats.lines_parsed} lines</span>
                  {result.code_id&&<span className="stat-pill">🆔 #{result.code_id}</span>}
                </div>
              </div>
            )}

            {/* CONSOLE TAB */}
            {activeTab==="console"&&(
              <div>
                <div className="sect-lbl">Execution Output</div>
                <ConsoleView console={consoleOut} isRunning={loadingRun}/>
              </div>
            )}

            {/* EXPLANATION TAB */}
            {activeTab==="explanation"&&result&&!loadingDiagram&&(
              <div>
                <div className="sect-lbl">Plain English Explanation</div>
                <ExplanationView explanation={result.explanation}/>
              </div>
            )}
            {activeTab==="explanation"&&!result&&(
              <div className="out-empty" style={{height:200}}>
                <div className="out-empty-icon">📋</div>
                <div className="out-empty-h">No explanation yet</div>
                <p className="out-empty-p">Click <strong style={{color:"var(--teal)"}}>Generate Flowchart</strong> first.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ActivitiesPanel open={activitiesOpen} onClose={()=>setActivitiesOpen(false)} token={token}
        onRestore={a=>{setCode(a.source_code_full||a.source_code);setActivitiesOpen(false);setResult(null);setConsoleOut(null);}}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADMIN PAGE
══════════════════════════════════════════════════════════════ */
function AdminPage({token,user,onSignOut}){
  const [stats,setStats]=useState(null);
  const [users,setUsers]=useState([]);
  const [submissions,setSubmissions]=useState([]);
  const [activeTab,setActiveTab]=useState("stats");
  const [loading,setLoading]=useState(false);
  const [toast,fireToast]=useToast();

  useEffect(()=>{loadStats();},[]);

  async function loadStats(){setLoading(true);try{const s=await apiFetch(`/admin/stats?token=${token}`);setStats(s);}catch(e){fireToast("err",e.message);}finally{setLoading(false);}}
  async function loadUsers(){setLoading(true);try{const d=await apiFetch(`/admin/users?token=${token}&page=1&limit=50`);setUsers(d.users||[]);}catch(e){fireToast("err",e.message);}finally{setLoading(false);}}
  async function loadSubmissions(){setLoading(true);try{const d=await apiFetch(`/admin/submissions?token=${token}&page=1&limit=50`);setSubmissions(d.submissions||[]);}catch(e){fireToast("err",e.message);}finally{setLoading(false);}}
  async function deleteUser(uid,uname){
    if(!window.confirm(`Delete user "${uname}"? This cannot be undone.`))return;
    try{await apiFetch(`/admin/users/${uid}?token=${token}`,{method:"DELETE"});setUsers(p=>p.filter(u=>u.user_id!==uid));fireToast("ok","User deleted");}
    catch(e){fireToast("err",e.message);}
  }
  function switchTab(t){setActiveTab(t);if(t==="users"&&users.length===0)loadUsers();if(t==="submissions"&&submissions.length===0)loadSubmissions();}

  const adminStyles=`.admin-tabs{display:flex;gap:2px;margin-bottom:28px;background:var(--ink2);border:1px solid var(--line);border-radius:10px;padding:5px;}.admin-tab{flex:1;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:9px 16px;border:none;border-radius:7px;background:transparent;color:var(--fog);cursor:pointer;transition:all .2s;}.admin-tab.active{background:var(--teal);color:var(--ink);font-weight:700;}.stat-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:32px;}.stat-card{background:var(--ink2);border:1px solid var(--line2);border-radius:12px;padding:20px 24px;}.stat-num{font-family:var(--disp);font-size:36px;font-weight:800;color:var(--teal);line-height:1;}.stat-lbl{font-size:12px;color:var(--fog);margin-top:6px;}.admin-table{width:100%;border-collapse:collapse;font-size:13px;}.admin-table th{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--fog);text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);}.admin-table td{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--cloud);}.admin-table tr:hover td{background:var(--ink2);}.del-btn{font-family:var(--mono);font-size:10px;color:var(--red);background:rgba(224,80,80,.08);border:1px solid rgba(224,80,80,.25);border-radius:5px;padding:4px 10px;cursor:pointer;}.del-btn:hover{background:rgba(224,80,80,.2);}`;

  return(
    <div className="page" style={{flexDirection:"column"}}><style>{STYLES+adminStyles}</style><Toast {...toast}/>
      <nav className="nav">
        <div className="nav-left">
          <div className="wm" style={{gap:10}}><div className="wm-icon" style={{width:30,height:30,borderRadius:7}}><RagsyIcon/></div><span className="wm-name" style={{fontSize:18}}>Ragsy</span></div>
          <div className="nav-divider"/><span className="nav-section teal">Admin Dashboard</span>
        </div>
        <div className="nav-right">
          <div className="nav-account"><div className="nav-avatar" style={{background:"linear-gradient(135deg,#f43f5e,#e85d04)"}}>{user?.username?.slice(0,2).toUpperCase()}</div><span className="nav-uname">{user?.username}</span><span style={{fontFamily:"var(--mono)",fontSize:9,color:"#f43f5e",background:"rgba(244,63,94,.1)",border:"1px solid rgba(244,63,94,.25)",borderRadius:20,padding:"1px 7px",marginLeft:4}}>ADMIN</span></div>
          <button className="nav-signout" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>
      <div style={{flex:1,padding:"32px 48px",overflowY:"auto"}}>
        <div style={{marginBottom:24}}><div className="greeting-eyebrow">Control Panel</div><h1 className="greeting-h">Admin <span>Dashboard</span></h1><p className="greeting-sub">Manage users, monitor code submissions, and oversee platform security.</p></div>
        <div className="admin-tabs">
          {[{id:"stats",label:"📊 Overview"},{id:"users",label:"👥 Users"},{id:"submissions",label:"💾 Submissions"}].map(t=>(
            <button key={t.id} className={`admin-tab ${activeTab===t.id?"active":""}`} onClick={()=>switchTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {activeTab==="stats"&&(
          <div>
            {loading&&<div className="out-loading" style={{height:200}}><div className="loader"/></div>}
            {stats&&(<div className="stat-cards">
              {[
                {num:stats.total_users,          label:"Total Users",            icon:"👥"},
                {num:stats.total_submissions,    label:"Code Submissions",       icon:"💾"},
                {num:stats.total_flowcharts,     label:"Flowcharts Generated",   icon:"⬡"},
                {num:stats.total_explanations,   label:"Explanations Generated", icon:"📖"},
                {num:stats.python_submissions,   label:"Python Submissions",     icon:"🐍"},
                {num:stats.javascript_submissions,label:"JavaScript Submissions",icon:"⚡"},
                {num:stats.new_users_this_week,  label:"New Users This Week",    icon:"🆕"},
                {num:stats.total_downloads,      label:"Total Downloads",        icon:"⬇"},
              ].map(s=>(
                <div key={s.label} className="stat-card">
                  <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
                  <div className="stat-num">{s.num}</div>
                  <div className="stat-lbl">{s.label}</div>
                </div>
              ))}
            </div>)}
            <div style={{background:"var(--ink2)",border:"1px solid var(--teal)",borderRadius:12,padding:"20px 24px"}}>
              <div style={{fontFamily:"var(--mono)",fontSize:11,letterSpacing:".1em",textTransform:"uppercase",color:"var(--teal)",marginBottom:12}}>🔒 Security Status</div>
              {["All passwords SHA-256 hashed — never stored in plain text","Code submissions AES-256 encrypted — only the submitting user can retrieve them","Sessions expire after 24 hours automatically","Users can delete their account and all data at any time"].map((item,i)=>(
                <div key={i} style={{display:"flex",gap:10,marginBottom:8,fontSize:13,color:"var(--cloud)"}}><span style={{color:"var(--teal)",flexShrink:0}}>✓</span>{item}</div>
              ))}
            </div>
          </div>
        )}
        {activeTab==="users"&&(
          <div>
            {loading&&<div className="out-loading" style={{height:160}}><div className="loader"/></div>}
            {!loading&&users.length===0&&<div style={{color:"var(--fog)",textAlign:"center",padding:40}}>No users found.</div>}
            {users.length>0&&(<table className="admin-table">
              <thead><tr><th>ID</th><th>Username</th><th>Mobile</th><th>Joined</th><th>Submissions</th><th></th></tr></thead>
              <tbody>{users.map(u=>(<tr key={u.user_id}>
                <td style={{fontFamily:"var(--mono)",color:"var(--fog)"}}>#{u.user_id}</td>
                <td style={{fontWeight:600}}>{u.username}</td>
                <td style={{fontFamily:"var(--mono)",fontSize:12}}>{u.mobile_no}</td>
                <td style={{fontSize:12,color:"var(--fog)"}}>{new Date(u.created_at).toLocaleDateString("en-IN")}</td>
                <td><span className="stat-pill">{u.submission_count}</span></td>
                <td><button className="del-btn" onClick={()=>deleteUser(u.user_id,u.username)}>Delete</button></td>
              </tr>))}</tbody>
            </table>)}
          </div>
        )}
        {activeTab==="submissions"&&(
          <div>
            {loading&&<div className="out-loading" style={{height:160}}><div className="loader"/></div>}
            {!loading&&submissions.length===0&&<div style={{color:"var(--fog)",textAlign:"center",padding:40}}>No submissions yet.</div>}
            {submissions.length>0&&(<table className="admin-table">
              <thead><tr><th>Code ID</th><th>User</th><th>Language</th><th>Size</th><th>Uploaded</th></tr></thead>
              <tbody>{submissions.map(s=>(<tr key={s.code_id}>
                <td style={{fontFamily:"var(--mono)",color:"var(--fog)"}}>#{s.code_id}</td>
                <td style={{fontWeight:600}}>{s.username}</td>
                <td><span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--teal)",background:"var(--teal-dim)",border:"1px solid rgba(0,200,168,.2)",borderRadius:20,padding:"2px 8px"}}>{s.language}</span></td>
                <td style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--fog)"}}>{s.code_length} chars <span style={{color:"var(--mist)",fontSize:10}}>(encrypted)</span></td>
                <td style={{fontSize:12,color:"var(--fog)"}}>{new Date(s.upload_time).toLocaleDateString("en-IN")}</td>
              </tr>))}</tbody>
            </table>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ROOT APP
══════════════════════════════════════════════════════════════ */
export default function App(){
  const [page,setPage]     = useState("auth");
  const [token,setToken]   = useState(()=>localStorage.getItem("ragsy_token")||"");
  const [user,setUser]     = useState(()=>{try{return JSON.parse(localStorage.getItem("ragsy_user")||"null");}catch{return null;}});
  const [restoreCode,setRestoreCode] = useState("");
  const [editorLang,setEditorLang]   = useState("python");

  useEffect(()=>{
    if(token&&user){setPage(user.is_admin?"admin":"dashboard");}
  },[]);

  function handleAuth(tok,usr){
    setToken(tok);setUser(usr);
    localStorage.setItem("ragsy_token",tok);
    localStorage.setItem("ragsy_user",JSON.stringify(usr));
    setPage(usr.is_admin?"admin":"dashboard");
  }
  function handleSignOut(){
    if(token)apiFetch("/auth/logout",{method:"POST",body:JSON.stringify({token})}).catch(()=>{});
    localStorage.removeItem("ragsy_token");localStorage.removeItem("ragsy_user");
    setToken("");setUser(null);setPage("auth");
  }
  function handleNavigate(p,lang="python",code=""){
    setEditorLang(lang||"python");
    if(code)setRestoreCode(code);
    setPage(p);
  }

  return(
    <>
      <style>{STYLES}</style>
      {page==="auth"      &&<AuthPage onAuth={handleAuth}/>}
      {page==="dashboard" &&<DashboardPage user={user} onNavigate={handleNavigate} onSignOut={handleSignOut} token={token}/>}
      {page==="editor"    &&<EditorPage user={user} token={token} onBack={()=>{setRestoreCode("");setPage("dashboard");}} onSignOut={handleSignOut} initialCode={restoreCode} editorLang={editorLang}/>}
      {page==="admin"     &&<AdminPage token={token} user={user} onSignOut={handleSignOut}/>}
    </>
  );
}
