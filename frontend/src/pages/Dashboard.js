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
            Write Python code on the left<br />then click ▶ Run & Visualize
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

const DEFAULT_CODE = `# Welcome to Code Visualizer Pro!
def check_number(n):
    if n > 0:
        return "Positive"
    else:
        return "Zero or Negative"

print(check_number(10))`;

const Dashboard = () => {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('System Ready');

  const [nodes, setNodes, onNodesChange] = useNodesState(PLACEHOLDER_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = e.target;
      const next = value.slice(0, selectionStart) + '    ' + value.slice(selectionEnd);
      setCode(next);
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = selectionStart + 4;
      }, 0);
    }
  };

  const handleVisualize = async () => {
    if (!code.trim()) {
      setError('Please write some Python code first.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('Generating Visualization...');

    try {
      // Note: Changed to 127.0.0.1 to match standard local backend access
      const response = await axios.post('http://127.0.0.1:8000/visualize', { code });
      const { nodes: n, edges: e } = response.data;

      setNodes(n && n.length > 0 ? n : PLACEHOLDER_NODES);
      setEdges(e || []);
      setStatus('Visualization Complete');
    } catch (err) {
      const msg = err.response?.data?.detail || 'Check backend connection.';
      setError(msg);
      setStatus('Error Occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#0f172a', color: '#f1f5f9', overflow: 'hidden' }}>
      
      {/* Top Navbar */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: '55px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#3b82f6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>PRO</div>
          <span style={{ fontWeight: 700, fontSize: '18px', letterSpacing: '-0.5px' }}>Code<span style={{ color: '#38bdf8' }}>Visualizer</span></span>
        </div>
        
        {/* Project Context - "Focus Mode" Indicator */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', border: '1px solid #334155', padding: '4px 10px', borderRadius: '20px' }}>
             <span style={{ color: '#10b981' }}>●</span> Focus Mode Active
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>NTTF Final Year Project</div>
        </div>
      </nav>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Editor Area */}
        <div style={{ width: '35%', minWidth: '350px', borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
          <div style={{ padding: '12px 15px', background: '#131c2f', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>editor.py</span>
            <span style={{ fontSize: '12px', color: '#475569' }}>Lines: {code.split('\n').length}</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{ flex: 1, padding: '20px', background: 'transparent', color: '#38bdf8', border: 'none', outline: 'none', resize: 'none', fontFamily: '"Fira Code", monospace', fontSize: '14px', lineHeight: '1.7' }}
          />
          
          <div style={{ padding: '20px', borderTop: '1px solid #1e293b', background: '#0f172a' }}>
            {error && (
              <div style={{ color: '#ef4444', marginBottom: '10px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px' }}>
                ⚠ {error}
              </div>
            )}
            <button 
              onClick={handleVisualize} 
              disabled={loading}
              style={{ 
                width: '100%', 
                padding: '14px', 
                background: loading ? '#334155' : '#3b82f6', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px', 
                cursor: loading ? 'not-allowed' : 'pointer', 
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              {loading ? 'Processing...' : '▶ Run & Visualize'}
            </button>
          </div>
        </div>

        {/* Right: Visualization Canvas */}
        <div style={{ flex: 1, position: 'relative', background: '#0b1120' }}>
          <ReactFlow 
            nodes={nodes} 
            edges={edges} 
            onNodesChange={onNodesChange} 
            onEdgesChange={onEdgesChange} 
            onConnect={onConnect} 
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={25} color="#1e293b" />
            <Controls style={{ background: '#1e293b', border: '1px solid #334155', color: 'white' }} />
            <MiniMap 
              style={{ background: '#0f172a', border: '1px solid #334155' }} 
              maskColor="rgba(15, 23, 42, 0.8)" 
              nodeColor="#1e293b"
            />
          </ReactFlow>
          
          {/* Bottom Status Bar */}
          <div style={{ position: 'absolute', bottom: '15px', right: '15px', background: '#1e293b', padding: '5px 15px', borderRadius: '20px', fontSize: '11px', border: '1px solid #334155', pointerEvents: 'none', zIndex: 10 }}>
            Status: <span style={{ color: loading ? '#fbbf24' : '#10b981' }}>{status}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;