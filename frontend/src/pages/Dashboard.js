import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────
// BUG FIX 1: BackgroundVariant was missing from the import.
//   The user's code used <Background color="#334155" gap={20} />
//   which works but uses the deprecated "color" prop.
//   Correct modern usage is variant={BackgroundVariant.Dots}.
//
// BUG FIX 2: addEdge and onConnect were completely missing from
//   the user's code. Without onConnect, the user cannot draw new
//   edges manually on the canvas — the connection handler was absent.
//
// BUG FIX 3: The user's code had no empty-state placeholder,
//   so the canvas was blank (white/dark void) before first run.
//
// BUG FIX 4: No Tab-key support in the editor textarea — typing
//   Tab would move browser focus away instead of indenting code.
//
// BUG FIX 5: No Ctrl+Enter shortcut to run without clicking.
//
// BUG FIX 6: No error display in the UI — errors were only
//   console.error + alert(), which is poor UX.
//
// BUG FIX 7: No stats display (node count / edge count / lines).
//
// BUG FIX 8: setNodes(response.data.nodes) with no null-guard —
//   if the backend returns empty nodes the canvas breaks.
//
// BUG FIX 9: Loading spinner was just text "Processing..." with
//   no visual indicator. Added CSS spin animation.
//
// BUG FIX 10: No status bar / navbar — the app had no identity.
// ─────────────────────────────────────────────────────────────────

// Placeholder shown on the canvas before any code is visualized
const PLACEHOLDER_NODES = [
  {
    id: 'placeholder',
    position: { x: 160, y: 120 },
    data: {
      label: (
        <div style={{ textAlign: 'center', padding: '8px 4px' }}>
          <div style={{ fontSize: '26px', marginBottom: '8px', lineHeight: 1 }}>🐍</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', marginBottom: '4px' }}>
            Ready to Visualize
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
            Write Python code on the left<br />then click ▶ Run &amp; Visualize
          </div>
        </div>
      ),
    },
    style: {
      background: '#1e293b',
      border: '1.5px dashed #334155',
      borderRadius: '12px',
      padding: '8px',
      minWidth: '200px',
    },
  },
];

// Default code loaded in editor on first open
const DEFAULT_CODE = `# Welcome to Code Visualizer Pro!
# Write Python code below and click ▶ Run & Visualize

def fibonacci(n):
    if n <= 1:
        return n
    else:
        return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(8):
    result = fibonacci(i)
    print(f"fib({i}) = {result}")
`;

// ─────────────────────────────────────────────────────────────────
const Dashboard = () => {
  // FIX: Use DEFAULT_CODE instead of the user's short inline string
  const [code, setCode]       = useState(DEFAULT_CODE);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');   // FIX: added error state
  const [stats, setStats]     = useState(null); // FIX: added stats state

  // FIX: Seed with placeholder so canvas is never blank
  const [nodes, setNodes, onNodesChange] = useNodesState(PLACEHOLDER_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // FIX: onConnect was completely absent — added so users can draw edges
  const onConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  // FIX: Tab indents instead of losing focus; Ctrl+Enter triggers run
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = e.target;
      const next = value.slice(0, selectionStart) + '    ' + value.slice(selectionEnd);
      setCode(next);
      requestAnimationFrame(() => {
        e.target.selectionStart = e.target.selectionEnd = selectionStart + 4;
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleVisualize();
    }
  };

  const handleVisualize = async () => {
    // FIX: guard against empty code
    if (!code.trim()) {
      setError('Please write some Python code first.');
      return;
    }
    setLoading(true);
    setError('');
    setStats(null);

    try {
      const response = await axios.post('http://localhost:8000/visualize', { code });
      const { nodes: n, edges: e, stats: s } = response.data;

      // FIX: null-guard — fall back to placeholder if backend returns nothing
      setNodes(n && n.length > 0 ? n : PLACEHOLDER_NODES);
      setEdges(e || []);
      setStats(s || null);

    } catch (err) {
      // FIX: Show error in UI, not just alert/console
      const msg =
        err.response?.data?.detail ||
        (err.code === 'ERR_NETWORK'
          ? 'Cannot connect to backend. Is FastAPI running on port 8000?'
          : 'Visualization failed. Please try again.');
      setError(msg);
      // Keep the previous visualization visible — don't wipe canvas on error
    } finally {
      setLoading(false);
    }
  };

  const lineCount = code.split('\n').length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: '#0f172a',
      color: '#f1f5f9',
      fontFamily: "'Inter', sans-serif",
      overflow: 'hidden',
    }}>

      {/* ── Navbar ────────────────────────────────────────────── */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '48px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            width: '26px', height: '26px',
            background: 'linear-gradient(135deg,#38bdf8,#a78bfa)',
            borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 700,
          }}>⟨⟩</span>
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px' }}>
            Code<span style={{ color: '#38bdf8' }}>Visualizer</span>
            <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '4px' }}>Pro</span>
          </span>
        </div>

        <span style={{
          fontSize: '11px', color: '#38bdf8',
          background: 'rgba(56,189,248,0.1)',
          border: '1px solid rgba(56,189,248,0.2)',
          borderRadius: '20px', padding: '3px 12px',
        }}>
          Python → Flowchart
        </span>

        <span style={{ fontSize: '12px', color: '#475569' }}>
          FastAPI • localhost:8000
        </span>
      </nav>

      {/* ── Status bar ────────────────────────────────────────── */}
      <div style={{
        padding: '3px 16px',
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        fontSize: '11px',
        color: '#475569',
        flexShrink: 0,
      }}>
        {loading
          ? '⏳ Parsing code with AST…'
          : stats
            ? `✅ ${stats.node_count} nodes · ${stats.edge_count} edges · ${stats.lines_parsed} lines parsed`
            : '📝 Ready — write Python code and click ▶ Run & Visualize'}
      </div>

      {/* ── Main split: Editor 40% | Visualizer 60% ───────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left: Code Editor (40%) ─────────────────────────── */}
        <div style={{
          width: '40%',
          minWidth: '280px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '2px solid #1e293b',
          background: '#0f172a',
          flexShrink: 0,
        }}>

          {/* Editor tab bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            background: '#1e293b',
            borderBottom: '1px solid #0f172a',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* macOS-style traffic lights */}
              <span style={{ width:'9px', height:'9px', borderRadius:'50%', background:'#f43f5e', display:'inline-block' }} />
              <span style={{ width:'9px', height:'9px', borderRadius:'50%', background:'#fb923c', display:'inline-block' }} />
              <span style={{ width:'9px', height:'9px', borderRadius:'50%', background:'#34d399', display:'inline-block' }} />
              <span style={{ fontFamily:"'Fira Code',monospace", fontSize:'12px', color:'#64748b', marginLeft:'6px' }}>
                main.py
              </span>
            </div>
            <span style={{ fontSize:'11px', color:'#475569' }}>
              {lineCount} lines · Python
            </span>
          </div>

          {/* Line numbers + textarea */}
          <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

            {/* Line number gutter */}
            <div style={{
              padding: '14px 8px',
              background: '#0f172a',
              borderRight: '1px solid #1e293b',
              minWidth: '38px',
              textAlign: 'right',
              userSelect: 'none',
              fontFamily: "'Fira Code', monospace",
              fontSize: '12px',
              lineHeight: '1.6',
              color: '#334155',
              overflowY: 'hidden',
              flexShrink: 0,
            }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            {/* FIX: Added onKeyDown for Tab + Ctrl+Enter support */}
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                flex: 1,
                padding: '14px',
                background: 'transparent',
                color: '#e2e8f0',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: "'Fira Code', 'Courier New', monospace",
                fontSize: '13px',
                lineHeight: '1.6',
                caretColor: '#38bdf8',
                overflowY: 'auto',
              }}
            />
          </div>

          {/* FIX: Error displayed in UI instead of alert() */}
          {error && (
            <div style={{
              margin: '0 12px 8px',
              padding: '8px 12px',
              background: 'rgba(244,63,94,0.1)',
              border: '1px solid rgba(244,63,94,0.3)',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '12px',
              fontFamily: "'Fira Code', monospace",
              flexShrink: 0,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Run button */}
          <div style={{ padding: '10px 14px', flexShrink: 0, background: '#0f172a', borderTop: '1px solid #1e293b' }}>
            <button
              onClick={handleVisualize}
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px',
                background: loading
                  ? '#1e293b'
                  : 'linear-gradient(135deg, #38bdf8, #818cf8)',
                color: loading ? '#64748b' : '#0f172a',
                fontWeight: 700,
                fontSize: '13px',
                border: 'none',
                borderRadius: '7px',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                transition: 'opacity 0.2s, transform 0.15s',
                letterSpacing: '0.3px',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {loading ? (
                <>
                  {/* FIX: Animated spinner instead of plain text */}
                  <span style={{
                    width: '11px', height: '11px',
                    border: '2px solid #475569',
                    borderTopColor: '#94a3b8',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Parsing…
                </>
              ) : (
                '▶  Run & Visualize'
              )}
            </button>
            <div style={{ textAlign:'center', marginTop:'6px', fontSize:'11px', color:'#334155' }}>
              ⌨ Tab = indent &nbsp;|&nbsp; Ctrl+Enter = Run
            </div>
          </div>
        </div>

        {/* ── Right: React Flow Canvas (60%) ──────────────────── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Floating canvas header */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 14px',
            background: 'rgba(15,23,42,0.85)',
            borderBottom: '1px solid #1e293b',
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
              🔀 Flowchart Canvas
            </span>

            {/* FIX: Stats badge — was completely missing */}
            {stats && (
              <div style={{ display: 'flex', gap: '16px' }}>
                {[
                  { label: 'Nodes', value: stats.node_count,   color: '#38bdf8' },
                  { label: 'Edges', value: stats.edge_count,   color: '#a78bfa' },
                  { label: 'Lines', value: stats.lines_parsed, color: '#34d399' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: '10px', color: '#475569' }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            <span style={{ fontSize: '11px', color: '#334155' }}>
              Drag · Zoom · Pan
            </span>
          </div>

          {/* FIX: BackgroundVariant.Dots (modern API) instead of color prop */}
          {/* FIX: onConnect added so user can draw edges on canvas          */}
          {/* FIX: paddingTop accounts for the floating header overlay       */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.5 }}
            attributionPosition="bottom-left"
            style={{ background: '#0f172a', paddingTop: '42px' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
            <Controls
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
              }}
            />
            <MiniMap
              nodeStrokeWidth={3}
              zoomable
              pannable
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
              }}
              nodeColor={(n) => {
                // Derive dot colour from each node's border style
                const border = n.style?.border;
                if (!border) return '#334155';
                const parts = border.split(' ');
                return parts[parts.length - 1] || '#334155';
              }}
              maskColor="rgba(15,23,42,0.75)"
            />
          </ReactFlow>
        </div>
      </div>

      {/* FIX: Spin keyframe for the loading spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default Dashboard;