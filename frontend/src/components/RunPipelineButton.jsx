/**
 * RunPipelineButton — compact, self-contained pipeline trigger.
 *
 * Props:
 *   label     — button text (default "Run Pipeline")
 *   step      — pipeline start step 1-7 (default 1)
 *   variant   — "inline" (default) | "bar" (full-width progress bar style)
 *   onDone    — callback fired when pipeline finishes; use to reload data
 */
import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const POLL_MS = 3000;

export default function RunPipelineButton({
  label   = 'Run Pipeline',
  step    = 1,
  variant = 'inline',
  onDone,
}) {
  const [status,   setStatus]   = useState(null);   // null | 'running' | 'done' | 'error'
  const [log,      setLog]      = useState([]);
  const [expanded, setExpanded] = useState(false);
  const pollRef = useRef(null);

  // Poll pipeline status while running
  useEffect(() => {
    if (status !== 'running') {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      api.getPipelineStatus().then(s => {
        if (!s) return;
        setLog(s.log_lines || []);
        if (!s.running) {
          clearInterval(pollRef.current);
          const final = s.status === 'error' ? 'error' : 'done';
          setStatus(final);
          if (final === 'done') onDone?.();
        }
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [status]);

  // Also check on mount — if pipeline already running, show it
  useEffect(() => {
    api.getPipelineStatus().then(s => {
      if (s?.running) {
        setStatus('running');
        setLog(s.log_lines || []);
      }
    }).catch(() => {});
  }, []);

  function run() {
    setStatus('running');
    setLog([]);
    setExpanded(true);
    api.startPipeline(step).catch(() => setStatus('error'));
  }

  function reset() { setStatus(null); setLog([]); setExpanded(false); }

  const isRunning = status === 'running';
  const isDone    = status === 'done';
  const isError   = status === 'error';

  const lastLog = log.slice(-1)[0] || '';

  if (variant === 'bar') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={isRunning ? undefined : (isDone || isError ? reset : run)}
            disabled={isRunning}
            style={{
              padding: '7px 18px', borderRadius: 7, border: 'none', fontWeight: 700, fontSize: 12,
              cursor: isRunning ? 'wait' : 'pointer',
              background: isRunning ? '#334155' : isError ? '#7f1d1d' : isDone ? '#14532d' : '#7c3aed',
              color: isRunning ? '#94a3b8' : '#fff',
              transition: 'background 0.2s',
            }}
          >
            {isRunning ? '⚙ Running…' : isError ? '✕ Error — Retry' : isDone ? '✓ Done — Run Again' : `⚡ ${label}`}
          </button>

          {isRunning && (
            <span style={{ fontSize: 11, color: '#94a3b8', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lastLog || 'Starting…'}
            </span>
          )}
          {(isRunning || log.length > 0) && (
            <button onClick={() => setExpanded(e => !e)}
              style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {expanded ? '▴ hide log' : '▾ show log'}
            </button>
          )}
        </div>
        {expanded && log.length > 0 && (
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
            padding: '8px 12px', fontSize: 10, fontFamily: 'monospace', color: '#64748b',
            maxHeight: 120, overflowY: 'auto', lineHeight: 1.7,
          }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>
    );
  }

  // Default: inline compact button
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        onClick={isRunning ? undefined : (isDone || isError ? reset : run)}
        disabled={isRunning}
        title={isRunning ? lastLog : `${label} (step ${step})`}
        style={{
          padding: '5px 14px', borderRadius: 6, border: '1px solid',
          borderColor: isRunning ? '#334155' : isError ? '#991b1b' : isDone ? '#15803d' : '#7c3aed',
          background:  isRunning ? 'rgba(51,65,85,0.3)' : isError ? 'rgba(127,29,29,0.15)' : isDone ? 'rgba(20,83,45,0.15)' : 'rgba(124,58,237,0.15)',
          color:       isRunning ? '#64748b' : isError ? '#f87171' : isDone ? '#4ade80' : '#a78bfa',
          fontWeight: 700, fontSize: 11, cursor: isRunning ? 'wait' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isRunning ? '⚙ Running…' : isError ? '✕ Retry' : isDone ? '✓ Done' : `⚡ ${label}`}
      </button>
      {isRunning && (
        <span style={{ fontSize: 10, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lastLog}
        </span>
      )}
    </div>
  );
}
