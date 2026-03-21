/**
 * UserMenu — Settings gear icon in the header.
 * Dropdown: My Profile, Change Password, Logout.
 */
import { useState, useRef, useEffect } from 'react';
import { api, setAuthToken } from '../api';

export default function UserMenu({ onLogout }) {
  const [open,      setOpen]      = useState(false);
  const [modal,     setModal]     = useState(null);   // null | 'profile' | 'password'
  const [user,      setUser]      = useState(() => {
    try { return JSON.parse(localStorage.getItem('screener_user') || '{}'); }
    catch { return {}; }
  });

  // Change password state
  const [oldPw,     setOldPw]     = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg,     setPwMsg]     = useState(null);   // {type:'ok'|'error', text}
  const [pwLoading, setPwLoading] = useState(false);

  const menuRef = useRef(null);

  useEffect(() => {
    function onClickOut(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

  function logout() {
    setAuthToken(null);
    localStorage.removeItem('screener_user');
    onLogout();
  }

  async function changePassword(e) {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg({ type: 'error', text: 'Passwords do not match' }); return; }
    if (newPw.length < 6)    { setPwMsg({ type: 'error', text: 'Password must be at least 6 characters' }); return; }
    setPwLoading(true);
    setPwMsg(null);
    try {
      await api.changePassword(oldPw, newPw);
      setPwMsg({ type: 'ok', text: 'Password changed successfully!' });
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message || 'Failed to change password' });
    } finally {
      setPwLoading(false);
    }
  }

  const initials = (user.name || user.email || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const inputStyle = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: 7, padding: '9px 12px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <>
      {/* Gear / avatar button */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          title="Settings"
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            color: 'var(--accent-cyan)', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {initials}
        </button>

        {open && (
          <div style={{
            position: 'absolute', right: 0, top: 40, zIndex: 999,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}>
            {/* User info */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{user.name || 'User'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{user.email}</div>
              {user.is_admin && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-cyan)', background: 'rgba(6,182,212,0.1)', borderRadius: 4, padding: '2px 6px', marginTop: 4, display: 'inline-block' }}>
                  ADMIN
                </span>
              )}
            </div>

            {/* Menu items */}
            {[
              { label: '👤  My Profile',       action: () => { setModal('profile'); setOpen(false); } },
              { label: '🔑  Change Password',  action: () => { setModal('password'); setOpen(false); } },
              { label: '—', divider: true },
              { label: '🚪  Sign Out',         action: logout, danger: true },
            ].map((item, i) =>
              item.divider ? (
                <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              ) : (
                <button key={i} onClick={item.action} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 16px', background: 'none', border: 'none',
                  color: item.danger ? 'var(--accent-red)' : 'var(--text-primary)',
                  fontSize: 13, cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  {item.label}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '28px 32px', width: 380, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {modal === 'profile' ? '👤 My Profile' : '🔑 Change Password'}
              </h3>
              <button onClick={() => setModal(null)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 18, cursor: 'pointer', lineHeight: 1,
              }}>×</button>
            </div>

            {modal === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[['Name', user.name || '—'], ['Email', user.email], ['Role', user.is_admin ? 'Admin' : 'User'], ['Account created', user.created_at || '—']].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{val}</span>
                  </div>
                ))}
              </div>
            )}

            {modal === 'password' && (
              <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  ['CURRENT PASSWORD', oldPw,     setOldPw,     'Current password'],
                  ['NEW PASSWORD',     newPw,     setNewPw,     'Min. 6 characters'],
                  ['CONFIRM PASSWORD', confirmPw, setConfirmPw, 'Repeat new password'],
                ].map(([label, val, setter, placeholder]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</label>
                    <input type="password" value={val} onChange={e => setter(e.target.value)}
                      placeholder={placeholder} required style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
                      onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
                  </div>
                ))}

                {pwMsg && (
                  <div style={{
                    padding: '9px 12px', borderRadius: 7, fontSize: 12,
                    background: pwMsg.type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(248,113,113,0.1)',
                    border: `1px solid ${pwMsg.type === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`,
                    color: pwMsg.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}>
                    {pwMsg.text}
                  </div>
                )}

                <button type="submit" disabled={pwLoading} style={{
                  padding: '10px', borderRadius: 7, border: 'none', fontWeight: 700, fontSize: 13,
                  background: pwLoading ? 'var(--bg-secondary)' : 'var(--accent-cyan)',
                  color: pwLoading ? 'var(--text-muted)' : '#0f172a',
                  cursor: pwLoading ? 'not-allowed' : 'pointer',
                }}>
                  {pwLoading ? 'Updating…' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
