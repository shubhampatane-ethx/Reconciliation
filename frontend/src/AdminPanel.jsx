/**
 * AdminPanel — system-wide dashboard shown only to ADMIN users.
 *
 * Pulls from the admin-only backend routes (all protected server-side by
 * @admin_required — this component being hidden from non-admins in the
 * frontend nav is a UX nicety, not the security boundary):
 *   GET /api/admin/users
 *   GET /api/admin/sessions
 *   GET /api/admin/series
 *   GET /api/admin/datasets
 */

import { useEffect, useState } from 'react';
import axios from 'axios';
import { authHeaders } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'sessions', label: 'Active Sessions' },
  { key: 'series', label: 'All Datasets' },
];

export default function AdminPanel({ token }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [u, s, sv] = await Promise.all([
          axios.get(`${API_BASE}/api/admin/users`, { headers: authHeaders(token) }),
          axios.get(`${API_BASE}/api/admin/sessions`, { headers: authHeaders(token) }),
          axios.get(`${API_BASE}/api/admin/series`, { headers: authHeaders(token) }),
        ]);
        if (cancelled) return;
        setUsers(u.data.users || []);
        setSessions(s.data.sessions || []);
        setSeries(sv.data.series || []);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || 'Failed to load admin data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="admin-panel">
      <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
      <p style={{ opacity: 0.7, marginTop: 4 }}>System-wide view across every user.</p>

      <div className="admin-tabs" style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div>Loading…</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && tab === 'users' && (
        <table className="data-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last Login</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.is_active ? 'Yes' : 'No'}</td>
                <td>{u.last_login || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && tab === 'sessions' && (
        <table className="data-table">
          <thead>
            <tr><th>User ID</th><th>Last Activity</th><th>Created</th><th>IP</th><th>Expires</th></tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.user_id}</td>
                <td>{s.last_activity}</td>
                <td>{s.created_at}</td>
                <td>{s.ip_address || '—'}</td>
                <td>{s.expires_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && tab === 'series' && (
        <table className="data-table">
          <thead>
            <tr><th>Series</th><th>Name</th><th>Owner (user_id)</th><th>Created</th></tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.series_id}>
                <td>{s.series_id}</td>
                <td>{s.name}</td>
                <td>{s.user_id ?? '—'}</td>
                <td>{s.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
