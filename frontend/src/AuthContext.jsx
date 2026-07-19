/**
 * AuthContext — global authentication state for the Reconciliation app.
 *
 * Provides:
 *   useAuth()  →  { user, token, login, register, logout, loading }
 *
 * - token: the JWT string, persisted in localStorage under "rc_token"
 * - user:  { id, full_name, email, created_at, updated_at, last_login,
 *            is_active } decoded from the /api/auth/me response
 * - login(email, password) → { ok: true } | { ok: false, error: "..." }
 * - register(fullName, email, password) → { ok: true } | { ok: false, error: "..." }
 * - logout() — clears state + storage and sends the user back to /login
 * - loading: true while the stored token is being re-validated on page load
 *
 * Every axios call that needs auth should attach the token via the helper:
 *   import { authHeaders } from './AuthContext';
 *   axios.get('/api/series', { headers: authHeaders(token) })
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const AuthContext = createContext(null);

/** Build the Authorization header object from a token string. */
export function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('rc_token') || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // validating stored token

  // ── Re-validate a stored token on first render ───────────────────────────
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    axios
      .get(`${API_BASE}/api/auth/me`, { headers: authHeaders(token) })
      .then((res) => setUser(res.data.user))
      .catch(() => {
        // Token expired or invalid — clear it so the user is sent to login
        localStorage.removeItem('rc_token');
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
      const { access_token, user: userData } = res.data;
      localStorage.setItem('rc_token', access_token);
      setToken(access_token);
      setUser(userData);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err?.response?.data?.error || 'Login failed. Please try again.',
      };
    }
  }, []);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (fullName, email, password) => {
    try {
      const res = await axios.post(`${API_BASE}/api/auth/register`, {
        full_name: fullName,
        email,
        password,
      });
      const { access_token, user: userData } = res.data;
      localStorage.setItem('rc_token', access_token);
      setToken(access_token);
      setUser(userData);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err?.response?.data?.error || 'Registration failed. Please try again.',
      };
    }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem('rc_token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Hook — throws if used outside <AuthProvider>. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
