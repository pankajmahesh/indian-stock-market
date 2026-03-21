export default function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '14px 24px',
      background: 'var(--bg-secondary)',
      marginTop: 'auto',
    }}>
      <p style={{
        margin: 0,
        fontSize: 11,
        color: 'var(--text-muted)',
        lineHeight: 1.7,
        textAlign: 'center',
        maxWidth: 900,
        marginInline: 'auto',
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Disclaimer:</strong>{' '}
        I am not a SEBI registered investment advisor or research analyst. The content shared here is purely
        for educational and informational purposes only and should not be considered financial advice.
        Please consult a qualified financial advisor or do your own research before making any investment
        decisions. I am not responsible for any profit or loss incurred.
      </p>
    </footer>
  );
}
