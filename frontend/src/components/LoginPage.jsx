import { useState } from 'react';
import { api, setAuthToken } from '../api';

const inputStyle = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 14px',
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export default function LoginPage({ onLogin }) {
  const [tab,      setTab]      = useState('login');   // 'login' | 'register'
  const [email,    setEmail]    = useState('');
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  function switchTab(t) {
    setTab(t);
    setError('');
    setEmail(''); setPassword(''); setName(''); setConfirm('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (tab === 'register') {
      if (password !== confirm) { setError('Passwords do not match'); return; }
      if (password.length < 6)  { setError('Password must be at least 6 characters'); return; }
    }

    setLoading(true);
    try {
      const res = tab === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password, name.trim());
      setAuthToken(res.token);
      // Store user info for header display
      localStorage.setItem('screener_user', JSON.stringify({
        email: res.email,
        name: res.name,
        is_admin: res.is_admin,
        created_at: res.created_at || '',
      }));
      onLogin(res.token);
    } catch (err) {
      setError(err.message || (tab === 'login' ? 'Login failed' : 'Registration failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '40px 44px',
        width: 400,
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px' }}>
            <span style={{ color: 'var(--accent-cyan)' }}>Indian</span>
            <span style={{ color: 'var(--text-primary)' }}> Stock Screener</span>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-muted)' }}>
            AI-powered NSE stock analysis platform
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: 'flex', background: 'var(--bg-secondary)', borderRadius: 8,
          border: '1px solid var(--border)', marginBottom: 24, overflow: 'hidden',
        }}>
          {[['login', 'Sign In'], ['register', 'Register']].map(([key, label]) => (
            <button key={key} onClick={() => switchTab(key)} style={{
              flex: 1, padding: '9px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              background: tab === key ? 'var(--accent-cyan)' : 'transparent',
              color: tab === key ? '#0f172a' : 'var(--text-muted)',
              transition: 'all 0.2s',
            }}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>FULL NAME</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name" required style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>EMAIL</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>PASSWORD</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
          </div>

          {tab === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>CONFIRM PASSWORD</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••" required style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--accent-red)',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 6, background: loading ? 'var(--bg-secondary)' : 'var(--accent-cyan)',
            color: loading ? 'var(--text-muted)' : '#0f172a',
            border: 'none', borderRadius: 8, padding: '12px',
            fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? (tab === 'login' ? 'Signing in…' : 'Creating account…')
                     : (tab === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        {tab === 'register' && (
          <div style={{ marginTop: 16, padding: '12px', background: 'rgba(6,182,212,0.05)', borderRadius: 8, border: '1px solid rgba(6,182,212,0.15)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            New accounts start with a blank portfolio. Upload your holdings CSV from the Portfolio section after signing in.
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Personal dashboard · Secured access
        </div>
      </div>
    </div>
  );
}
