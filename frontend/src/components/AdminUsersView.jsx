import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AdminUsersView() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyEmail, setBusyEmail] = useState('');

  const loadUsers = () => {
    setLoading(true);
    setError('');
    api.getAdminUsers()
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const deleteUser = async (user) => {
    if (!window.confirm(`Delete user ${user.email}? This will also remove their saved portfolio data.`)) return;
    setBusyEmail(user.email);
    setError('');
    try {
      await api.deleteAdminUser(user.email);
      setUsers((prev) => prev.filter((u) => u.email !== user.email));
    } catch (e) {
      setError(e.message || 'Failed to delete user');
    } finally {
      setBusyEmail('');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Registered Users</h2>
          <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 13 }}>
            Admin-only user management. Deleting a user also removes their saved portfolio files.
          </div>
        </div>
        <button className="nav-tab active" onClick={loadUsers} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5',
        }}>
          {error}
        </div>
      )}

      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.9fr',
          gap: 12, padding: '12px 16px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div>User</div>
          <div>Created</div>
          <div>Role</div>
          <div style={{ textAlign: 'right' }}>Action</div>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading users...</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>No users found.</div>
        ) : (
          users.map((user) => (
            <div
              key={user.email}
              style={{
                display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.9fr',
                gap: 12, padding: '14px 16px', alignItems: 'center',
                borderBottom: '1px solid rgba(148,163,184,0.10)',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user.name || 'Unnamed user'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{user.email}</div>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{user.created_at || '—'}</div>
              <div>
                <span style={{
                  padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                  color: user.is_admin ? '#22c55e' : '#94a3b8',
                  background: user.is_admin ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                }}>
                  {user.is_admin ? 'Admin' : 'User'}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                {user.is_admin ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Protected</span>
                ) : (
                  <button
                    onClick={() => deleteUser(user)}
                    disabled={busyEmail === user.email}
                    style={{
                      border: 'none', borderRadius: 8, padding: '8px 12px',
                      background: 'rgba(239,68,68,0.12)', color: '#f87171',
                      fontWeight: 700, cursor: busyEmail === user.email ? 'wait' : 'pointer',
                    }}
                  >
                    {busyEmail === user.email ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
