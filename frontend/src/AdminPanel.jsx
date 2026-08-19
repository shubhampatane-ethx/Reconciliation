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

import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { authHeaders } from './AuthContext';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'sessions', label: 'Active Sessions' },
  { key: 'series', label: 'All Datasets' },
];

export default function AdminPanel({ token }) {
  const rootRef = useRef(null);
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [u, s, sv] = await Promise.all([
        axios.get(`${API_BASE}/api/admin/users`, { headers: authHeaders(token) }),
        axios.get(`${API_BASE}/api/admin/sessions`, { headers: authHeaders(token) }),
        axios.get(`${API_BASE}/api/admin/series`, { headers: authHeaders(token) }),
      ]);
      setUsers(u.data.users || []);
      setSessions(s.data.sessions || []);
      setSeries(sv.data.series || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load admin data.');
    } finally {
      setLoading(false);
      requestAnimationFrame(forceGridReflow);
    }
  }

  // Chromium/WebKit sometimes fail to recompute a CSS Grid `fr` column's
  // width for a subtree mounted *after* the page's initial layout pass
  // (exactly what happens here: AdminPanel doesn't exist in the DOM at
  // all until the user clicks the Admin nav item). The layout is
  // otherwise correct but stays visually collapsed/misplaced until
  // something forces a real recalculation — resizing the window (or
  // opening DevTools, which resizes the viewport) does this, which is
  // why it "fixes itself" there. A synthetic `resize` *event* does NOT
  // do this on its own — nothing in this app listens for resize to
  // resize anything, so firing the event alone is a no-op. What
  // actually forces Chromium to redo the grid track calculation is
  // toggling the grid container's `display` off and back on, which
  // fully invalidates its cached layout.
  function forceGridReflow() {
    // Toggle the whole grid shell, since that's the ancestor whose `fr`
    // track width is what's actually miscomputed.
    const shell = document.querySelector('.app-shell');
    if (shell) {
      const prevDisplay = shell.style.display;
      shell.style.display = 'none';
      void shell.offsetHeight;
      shell.style.display = prevDisplay;
    }
    // Also toggle AdminPanel's own root, targeting exactly the subtree
    // that's proven to render correctly once "activated" — belt and
    // braces in case the app-shell toggle alone isn't enough.
    if (rootRef.current) {
      const prevDisplay = rootRef.current.style.display;
      rootRef.current.style.display = 'none';
      void rootRef.current.offsetHeight;
      rootRef.current.style.display = prevDisplay;
    }
  }

  useEffect(() => {
    // Also force it once on mount, in case the blank-until-resize state
    // happens before any data even arrives (i.e. it's the act of
    // mounting AdminPanel into the grid, not the data load, that
    // triggers the stale layout).
    requestAnimationFrame(forceGridReflow);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Any user with at least one active session (already filtered to
  // is_active=true by the /api/admin/sessions endpoint) is "logged in
  // now". Built from the sessions list already fetched above.
  const loggedInUserIds = new Set(sessions.map((s) => s.user_id));

  async function handleDeleteUser(user) {
    if (!window.confirm(`Permanently delete ${user.full_name} (${user.email})? This cannot be undone.`)) {
      return;
    }
    setActionError('');
    setDeletingId(user.id);
    try {
      await axios.delete(`${API_BASE}/api/admin/users/${user.id}`, { headers: authHeaders(token) });
      await loadAll();
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Failed to delete user.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="admin-panel" ref={rootRef}>
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

      {actionError && <div className="error-banner">{actionError}</div>}

      {!loading && !error && tab === 'users' && (
        <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Logged In</th><th>Last Login</th><th style={{ width: 90 }}></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isLoggedIn = loggedInUserIds.has(u.id);
              const isBuiltInAdmin = u.email === 'admin@gmail.com';
              return (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? 'Yes' : 'No'}</td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                      color: isLoggedIn ? '#16a34a' : 'inherit', opacity: isLoggedIn ? 1 : 0.6,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: isLoggedIn ? '#16a34a' : '#9ca3af', display: 'inline-block',
                      }} />
                      {isLoggedIn ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{u.last_login || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      className="btn-danger"
                      disabled={isBuiltInAdmin || deletingId === u.id}
                      onClick={() => handleDeleteUser(u)}
                      title={isBuiltInAdmin ? 'The built-in admin account cannot be deleted.' : 'Delete user'}
                    >
                      {deletingId === u.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {!loading && !error && tab === 'sessions' && (
        <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>User ID</th><th>Last Activity</th><th>Created</th><th>IP</th><th>Expires</th></tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.user_id}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.last_activity}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.created_at}</td>
                <td>{s.ip_address || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.expires_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {!loading && !error && tab === 'series' && (
        <div className="data-table-wrap">
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
                <td style={{ whiteSpace: 'nowrap' }}>{s.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}