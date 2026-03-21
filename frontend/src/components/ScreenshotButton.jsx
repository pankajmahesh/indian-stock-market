import { useState } from 'react';
import html2canvas from 'html2canvas';

/**
 * Reusable screenshot/download button.
 *
 * Usage:
 *   <ScreenshotButton targetRef={containerRef} filename="my-report" />
 *
 * Props:
 *   targetRef  — React ref to the DOM element to capture
 *   filename   — base filename (without extension), default "screenshot"
 *   label      — button text, default "Download"
 */
export default function ScreenshotButton({ targetRef, filename = 'screenshot', label = 'Download' }) {
  const [busy, setBusy] = useState(false);

  const handleScreenshot = async () => {
    if (!targetRef?.current || busy) return;
    setBusy(true);
    try {
      const canvas = await html2canvas(targetRef.current, {
        backgroundColor: '#0f172a',  // match app dark bg
        scale: 2,                    // 2x for crisp output
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 10);
      link.download = `${filename}_${ts}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleScreenshot}
      disabled={busy}
      style={{
        padding: '6px 14px', borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-secondary)',
        cursor: busy ? 'wait' : 'pointer',
        fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}
    >
      {busy ? 'Capturing...' : label}
    </button>
  );
}
