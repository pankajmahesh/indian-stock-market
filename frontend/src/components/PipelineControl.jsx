import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const STEPS = ['Universe', 'Red Flags', 'Fundamentals', 'Technicals', 'Ranking', 'Deep Dive', 'Final Output'];

function parseCurrentStep(statusText) {
  if (!statusText) return 0;
  const m = statusText.match(/step\s*(\d)/i);
  return m ? parseInt(m[1]) : 0;
}

export default function PipelineControl({ onPipelineComplete }) {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [step, setStep] = useState(1);
  const [skipCache, setSkipCache] = useState(false);
  const pollRef = useRef(null);
  const logEndRef = useRef(null);

  // Schedule state
  const [schedule, setSchedule] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedTime, setSchedTime] = useState('16:00');
  const [schedDays, setSchedDays] = useState('1-5');
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState(null);

  // Poll pipeline status when running
  useEffect(() => {
    checkStatus();
    api.getPipelineSchedule().then(setSchedule).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function checkStatus() {
    api.getPipelineStatus()
      .then(s => {
        setStatus(s);
        setLogs(s.log_lines || []);
        if (s.running && !pollRef.current) {
          pollRef.current = setInterval(pollStatus, 3000);
        }
      })
      .catch(() => {});
  }

  function pollStatus() {
    api.getPipelineStatus()
      .then(s => {
        setStatus(s);
        setLogs(s.log_lines || []);
        if (!s.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s.status === 'completed') onPipelineComplete?.();
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function handleStart() {
    try {
      await api.startPipeline(step, skipCache);
      setShowLogs(true);
      pollRef.current = setInterval(pollStatus, 3000);
      setTimeout(pollStatus, 1000);
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleStop() {
    try {
      await api.stopPipeline();
      setTimeout(pollStatus, 1000);
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleSaveSchedule() {
    setSchedSaving(true);
    setSchedMsg(null);
    try {
      const res = await api.setPipelineSchedule(schedTime, schedDays);
      setSchedule({ scheduled: true, time_ist: schedTime, days: schedDays === '1-5' ? 'Mon-Fri' : schedDays });
      setSchedMsg({ ok: true, text: res.message });
    } catch (e) {
      setSchedMsg({ ok: false, text: e.message });
    } finally {
      setSchedSaving(false);
    }
  }

  async function handleRemoveSchedule() {
    setSchedSaving(true);
    try {
      await api.deletePipelineSchedule();
      setSchedule({ scheduled: false });
      setSchedMsg({ ok: true, text: 'Schedule removed' });
    } catch (e) {
      setSchedMsg({ ok: false, text: e.message });
    } finally {
      setSchedSaving(false);
    }
  }

  const [mlTraining, setMlTraining] = useState(false);
  const [mlMsg, setMlMsg] = useState(null);
  const mlPollRef = useRef(null);

  async function handleTrainML() {
    setMlMsg(null);
    setMlTraining(true);
    try {
      await api.trainMLModels();
      // Poll for completion
      mlPollRef.current = setInterval(async () => {
        try {
          const s = await api.getMLTrainStatus();
          if (!s.running) {
            clearInterval(mlPollRef.current);
            mlPollRef.current = null;
            setMlTraining(false);
            if (s.summary?.error) {
              setMlMsg({ ok: false, text: `Error: ${s.summary.error}` });
            } else {
              const horizons = s.summary?.horizons || {};
              const info = Object.entries(horizons)
                .map(([h, v]) => `${h}d: ${v.val_dir_acc}% dir`)
                .join(', ');
              setMlMsg({ ok: true, text: `Models trained! ${info || 'done'}` });
            }
          }
        } catch {}
      }, 4000);
    } catch (e) {
      setMlTraining(false);
      setMlMsg({ ok: false, text: e.message });
    }
  }

  const running = status?.running;
  const statusText = status?.status || 'idle';
  const completed = statusText === 'completed';
  const currentStep = running ? parseCurrentStep(statusText) : completed ? 7 : 0;

  return (
    <div className="card">
      <h2>Pipeline Control</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {/* Step selector */}
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Start from Step:
          <select
            value={step}
            onChange={e => setStep(Number(e.target.value))}
            disabled={running}
            style={{
              marginLeft: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 13,
            }}
          >
            <option value={1}>1 - Universe</option>
            <option value={2}>2 - Red Flags</option>
            <option value={3}>3 - Fundamentals</option>
            <option value={4}>4 - Technicals</option>
            <option value={5}>5 - Ranking</option>
            <option value={6}>6 - Deep Dive</option>
            <option value={7}>7 - Final Output</option>
          </select>
        </label>

        {/* Skip cache toggle */}
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={skipCache}
            onChange={e => setSkipCache(e.target.checked)}
            disabled={running}
          />
          Skip Cache
        </label>

        {/* Action buttons */}
        {!running ? (
          <button
            onClick={handleStart}
            style={{
              background: 'var(--accent-green)', color: '#fff', border: 'none',
              padding: '8px 20px', borderRadius: 8, fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Run Pipeline
          </button>
        ) : (
          <button
            onClick={handleStop}
            style={{
              background: 'var(--accent-red)', color: '#fff', border: 'none',
              padding: '8px 20px', borderRadius: 8, fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Stop Pipeline
          </button>
        )}

        <button
          onClick={() => setShowLogs(!showLogs)}
          className="nav-tab"
          style={{ fontSize: 12 }}
        >
          {showLogs ? 'Hide Logs' : 'Show Logs'}
        </button>

        {/* Train ML Models button */}
        <button
          onClick={handleTrainML}
          disabled={mlTraining || running}
          className="nav-tab"
          style={{
            fontSize: 12,
            color: mlTraining ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
            borderColor: mlTraining ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
            opacity: (mlTraining || running) ? 0.6 : 1,
          }}
        >
          {mlTraining ? '⚙ Training ML...' : '⚙ Train ML Models'}
        </button>

        {/* Schedule button */}
        <button
          onClick={() => { setShowSchedule(!showSchedule); setSchedMsg(null); }}
          className="nav-tab"
          style={{
            fontSize: 12,
            color: schedule?.scheduled ? 'var(--accent-cyan)' : undefined,
            borderColor: schedule?.scheduled ? 'var(--accent-cyan)' : undefined,
          }}
        >
          {schedule?.scheduled ? `⏰ ${schedule.time_ist} IST` : '⏰ Schedule'}
        </button>

        {/* Status indicator */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: running ? 'var(--accent-yellow)' : statusText === 'completed' ? 'var(--accent-green)' : 'var(--text-muted)',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: running ? 'var(--accent-yellow)' : statusText === 'completed' ? 'var(--accent-green)' : 'var(--text-muted)',
            display: 'inline-block',
            animation: running ? 'spin 1s linear infinite' : 'none',
          }} />
          {statusText}
        </span>
      </div>

      {/* Step progress */}
      {(running || completed) && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const done = currentStep > stepNum || (completed && currentStep >= stepNum);
            const active = running && currentStep === stepNum;
            return (
              <div key={stepNum} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: done || active ? (done ? '#0f2a1a' : '#1a1a0f') : 'var(--bg-secondary)',
                  border: `1px solid ${done ? 'var(--accent-green)' : active ? 'var(--accent-yellow)' : 'var(--border)'}`,
                  color: done ? 'var(--accent-green)' : active ? 'var(--accent-yellow)' : 'var(--text-muted)',
                }}>
                  {done ? '✓' : stepNum} {label}
                </div>
                {stepNum < 7 && <span style={{ color: 'var(--border)', fontSize: 10 }}>›</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Schedule panel */}
      {showSchedule && (
        <div style={{
          background: '#0d1117', border: '1px solid var(--border)', borderRadius: 8,
          padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>
            Auto-Schedule Pipeline
          </div>

          {schedule?.scheduled && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, background: '#0f2a1a',
              border: '1px solid var(--accent-green)', marginBottom: 12,
              fontSize: 12, color: 'var(--accent-green)',
            }}>
              Currently scheduled: daily at <strong>{schedule.time_ist} IST</strong> ({schedule.days})
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Time (IST):
              <input
                type="time"
                value={schedTime}
                onChange={e => setSchedTime(e.target.value)}
                style={{
                  marginLeft: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', padding: '5px 8px', borderRadius: 6, fontSize: 13,
                }}
              />
            </label>

            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Days:
              <select
                value={schedDays}
                onChange={e => setSchedDays(e.target.value)}
                style={{
                  marginLeft: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', padding: '5px 8px', borderRadius: 6, fontSize: 13,
                }}
              >
                <option value="1-5">Mon–Fri</option>
                <option value="1-6">Mon–Sat</option>
                <option value="*">Every day</option>
              </select>
            </label>

            <button
              onClick={handleSaveSchedule}
              disabled={schedSaving}
              style={{
                background: 'var(--accent-cyan)', color: '#000', border: 'none',
                padding: '7px 18px', borderRadius: 7, fontWeight: 700, fontSize: 13,
                cursor: schedSaving ? 'not-allowed' : 'pointer', opacity: schedSaving ? 0.6 : 1,
              }}
            >
              {schedSaving ? 'Saving...' : 'Save Schedule'}
            </button>

            {schedule?.scheduled && (
              <button
                onClick={handleRemoveSchedule}
                disabled={schedSaving}
                style={{
                  background: 'transparent', color: 'var(--accent-red)', border: '1px solid var(--accent-red)',
                  padding: '7px 14px', borderRadius: 7, fontWeight: 600, fontSize: 12,
                  cursor: schedSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Remove
              </button>
            )}
          </div>

          {schedMsg && (
            <div style={{
              marginTop: 10, fontSize: 12, padding: '6px 10px', borderRadius: 5,
              background: schedMsg.ok ? '#0f2a1a' : '#2a0f0f',
              color: schedMsg.ok ? 'var(--accent-green)' : 'var(--accent-red)',
            }}>
              {schedMsg.text}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
            Runs <code>main.py</code> via macOS cron at the scheduled IST time.
            Logs saved to <code>data/pipeline_cron.log</code>.<br />
            Recommended: 4:00 PM IST (after market close at 3:30 PM).
          </div>
        </div>
      )}

      {/* ML training result */}
      {mlMsg && (
        <div style={{
          marginBottom: 12, fontSize: 12, padding: '8px 12px', borderRadius: 6,
          background: mlMsg.ok ? '#0f2a1a' : '#2a0f0f',
          color: mlMsg.ok ? 'var(--accent-green)' : 'var(--accent-red)',
          border: `1px solid ${mlMsg.ok ? 'var(--accent-green)' : 'var(--accent-red)'}`,
        }}>
          ⚙ {mlMsg.text}
        </div>
      )}

      {/* Log output */}
      {showLogs && (
        <div style={{
          background: '#0d0f16', border: '1px solid var(--border)',
          borderRadius: 8, padding: 12, maxHeight: 400, overflowY: 'auto',
          fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7,
        }}>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No logs yet. Start the pipeline to see output.</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} style={{
                color: line.includes('ERROR') || line.includes('WARNING') ? 'var(--accent-red)' :
                  line.includes('INFO') && line.includes('STEP') ? 'var(--accent-cyan)' :
                  line.includes('complete') || line.includes('COMPLETE') ? 'var(--accent-green)' :
                  'var(--text-secondary)',
              }}>
                {line}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
