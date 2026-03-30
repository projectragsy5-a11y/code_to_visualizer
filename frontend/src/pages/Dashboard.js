import React, { useState } from 'react';
import axios from 'axios';


// Note: I've kept your team's CSS styles in the bottom of this file
const Dashboard = () => {
  const [code, setCode] = useState('print("Hello NTTF!")');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleRunCode = async () => {
    setLoading(true);
    try {
      // This talks to your Python Backend (main.py)
      const response = await axios.post('http://127.0.0.1:8000/visualize', {
        code: code
      });
      setResult(response.data);
    } catch (error) {
      console.error("Backend Error:", error);
      alert("Make sure your Python backend is running!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.pageBackground}>
      {/* Navbar */}
      <nav style={styles.dashNav}>
        <div style={styles.dashNavLeft}>
          <div style={styles.dashWordmarkIcon}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
              <path d="M4 6h6M4 10h4M4 14h8M14 4l6 8-6 8" />
            </svg>
          </div>
          <span style={styles.logoText}>Ragsy — Code to Visualizer</span>
        </div>
        <div style={styles.dashNavRight}>
          <span style={styles.projectBadge}>NTTF FINAL YEAR PROJECT</span>
        </div>
      </nav>

      {/* Main Content Area */}
      <div style={styles.mainLayout}>
        {/* Left: Code Editor */}
        <div style={styles.editorPanel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>
              <div style={styles.dot}></div> PYTHON SOURCE
            </span>
          </div>
          <textarea 
            style={styles.codeEditor}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your Python code here..."
          />
          <div style={styles.runBar}>
            <button 
              style={loading ? {...styles.btnRun, opacity: 0.5} : styles.btnRun} 
              onClick={handleRunCode}
              disabled={loading}
            >
              {loading ? "PROCESSING..." : "▶ RUN & VISUALIZE"}
            </button>
          </div>
        </div>

        {/* Right: Visualization Output */}
        <div style={styles.outputPanel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>ARCHITECTURE PREVIEW</span>
          </div>
          <div style={styles.outputContent}>
            {!result && !loading && (
              <div style={styles.emptyState}>
                <h3>Ready for Input</h3>
                <p>Enter code on the left to generate the architecture diagram.</p>
              </div>
            )}
            
            {loading && <div style={styles.loader}>Generating Flowchart...</div>}

            {result && (
              <div style={styles.resultArea}>
                <div style={styles.diagramBox}>
                  {/* This is where the Python-generated Flowchart goes */}
                  <img 
                    src={`data:image/png;base64,${result.image}`} 
                    alt="Architecture Diagram" 
                    style={{maxWidth: '100%'}}
                  />
                </div>
                <div style={styles.explanationCard}>
                  <h4>Analysis Report:</h4>
                  <p>{result.explanation || "No explanation generated."}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Internal CSS to keep the "Team Look" (Simplified for React)
const styles = {
  pageBackground: { backgroundColor: '#2d2f3a', height: '100vh', display: 'flex', flexDirection: 'column', color: 'white', fontFamily: 'DM Sans, sans-serif' },
  dashNav: { height: '64px', backgroundColor: '#4466a5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', borderBottom: '1px solid #1E2530' },
  logoText: { fontFamily: 'Syne, sans-serif', fontWeight: '800', fontSize: '18px' },
  projectBadge: { fontSize: '10px', backgroundColor: 'rgba(0,200,168,.12)', color: '#00C8A8', padding: '4px 12px', borderRadius: '20px', border: '1px solid #00C8A8' },
  mainLayout: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' },
  editorPanel: { borderRight: '1px solid #1E2530', display: 'flex', flexDirection: 'column' },
  panelHeader: { padding: '16px 24px', backgroundColor: '#3A4658', display: 'flex', alignItems: 'center', borderBottom: '1px solid #1E2530' },
  panelTitle: { fontSize: '11px', letterSpacing: '.12em', color: '#8FA3BA', display: 'flex', alignItems: 'center', gap: '8px' },
  dot: { width: '8px', height: '8px', backgroundColor: '#00C8A8', borderRadius: '50%' },
  codeEditor: { flex: 1, backgroundColor: '#181D24', color: '#A8D8B8', fontFamily: 'DM Mono, monospace', padding: '24px', border: 'none', outline: 'none', resize: 'none', fontSize: '14px' },
  runBar: { padding: '14px 24px', backgroundColor: '#4466a5' },
  btnRun: { backgroundColor: '#00C8A8', color: '#181D24', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', width: '100%' },
  outputPanel: { display: 'flex', flexDirection: 'column', backgroundColor: '#181D24' },
  outputContent: { padding: '24px', overflowY: 'auto', flex: 1 },
  emptyState: { textAlign: 'center', marginTop: '100px', color: '#5A6880' },
  loader: { color: '#00C8A8', textAlign: 'center', marginTop: '50px' },
  explanationCard: { marginTop: '20px', padding: '15px', backgroundColor: '#2d2f3a', borderRadius: '8px', border: '1px solid #3A4658' },
  diagramBox: { backgroundColor: 'white', padding: '10px', borderRadius: '8px' }
};

export default Dashboard;