/**
 * AuthContext — global authentication state for the Reconciliation app.
 *
 * Provides:
 *   useAuth()  →  { user, token, isAdmin, login, register, logout, loading }
 *
 * - token:         the current access JWT (15 min lifetime), persisted in
 *                   localStorage under "rc_token"
 * - refreshToken:  opaque refresh token (7 day lifetime), persisted under
 *                   "rc_refresh_token". Never sent to the backend except to
 *                   /api/auth/refresh.
 * - user:          { id, full_name, email, created_at, updated_at,
 *                    last_login, is_active, role } decoded from
 *                    /api/auth/me
 * - isAdmin:       true when user.role === "ADMIN"
 * - login(email, password) → { ok: true } | { ok: false, error: "..." }
 * - register(fullName, email, password) → { ok: true } | { ok: false, error: "..." }
 * - logout() — invalidates the session server-side, clears state +
 *   storage, and sends the user back to /login
 * - loading: true while the stored token is being re-validated on page load
 *
 * Access tokens are short-lived (15 min) by design — an axios response
 * interceptor transparently exchanges the refresh token for a new access
 * token on a 401 and retries the original request exactly once, so most
 * expiries are invisible to the rest of the app. If the refresh token
 * itself is invalid/expired/revoked (e.g. logged out elsewhere, idle
 * timeout, single-active-session eviction by a newer login), the user is
 * logged out and redirected to /login.
 *
 * Every axios call that needs auth should attach the token via the helper:
 *   import { authHeaders } from './AuthContext';
 *   axios.get('/api/series', { headers: authHeaders(token) })
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'rc_token';
const REFRESH_KEY = 'rc_refresh_token';

const AuthContext = createContext(null);

/** Build the Authorization header object from a token string. */
export function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem(REFRESH_KEY) || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // validating stored token

  // Keep a ref in sync so the axios interceptor (registered once) always
  // reads the latest tokens without needing to be re-registered.
  const tokenRef = useRef(token);
  const refreshTokenRef = useRef(refreshToken);
  tokenRef.current = token;
  refreshTokenRef.current = refreshToken;

  const applyTokens = useCallback((accessToken, newRefreshToken) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    setToken(accessToken);
    if (newRefreshToken) {
      localStorage.setItem(REFRESH_KEY, newRefreshToken);
      setRefreshToken(newRefreshToken);
    }
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setRefreshToken(null);
    setUser(null);
  }, []);

  // ── Silent access-token refresh, used on page load and by the
  //    interceptor. Returns the new access token, or null on failure. ──────
  const silentRefresh = useCallback(async () => {
    const rt = refreshTokenRef.current;
    if (!rt) return null;
    try {
      const res = await axios.post(`${API_BASE}/api/auth/refresh`, { refresh_token: rt });
      const { access_token, refresh_token: newRt } = res.data;
      applyTokens(access_token, newRt);
      return access_token;
    } catch {
      clearAuth();
      return null;
    }
  }, [applyTokens, clearAuth]);

  // ── Axios interceptor: on a 401, try one silent refresh + retry ──────────
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      async (error) => {
        const original = error.config || {};
        const status = error?.response?.status;
        const isAuthRoute = (original.url || '').includes('/api/auth/');
        if (status === 401 && !original._retried && !isAuthRoute && refreshTokenRef.current) {
          original._retried = true;
          const newAccessToken = await silentRefresh();
          if (newAccessToken) {
            original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newAccessToken}` };
            return axios(original);
          }
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, [silentRefresh]);

  // ── Re-validate a stored token on first render ───────────────────────────
  useEffect(() => {
    async function bootstrap() {
      if (!tokenRef.current) {
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get(`${API_BASE}/api/auth/me`, { headers: authHeaders(tokenRef.current) });
        setUser(res.data.user);
      } catch {
        // Access token may simply be past its 15-minute expiry — try a
        // silent refresh before giving up and sending the user to login.
        const newAccessToken = await silentRefresh();
        if (newAccessToken) {
          try {
            const res = await axios.get(`${API_BASE}/api/auth/me`, { headers: authHeaders(newAccessToken) });
            setUser(res.data.user);
          } catch {
            clearAuth();
          }
        }
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
      const { access_token, refresh_token, user: userData } = res.data;
      applyTokens(access_token, refresh_token);
      setUser(userData);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err?.response?.data?.error || 'Login failed. Please try again.',
      };
    }
  }, [applyTokens]);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (fullName, email, password) => {
    try {
      const res = await axios.post(`${API_BASE}/api/auth/register`, {
        full_name: fullName,
        email,
        password,
      });
      const { access_token, refresh_token, user: userData } = res.data;
      applyTokens(access_token, refresh_token);
      setUser(userData);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err?.response?.data?.error || 'Registration failed. Please try again.',
      };
    }
  }, [applyTokens]);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    const currentToken = tokenRef.current;
    if (currentToken) {
      // Best-effort — invalidate the session server-side so the token
      // can't be reused even if it leaks. Don't block the UI on it.
      axios
        .post(`${API_BASE}/api/auth/logout`, {}, { headers: authHeaders(currentToken) })
        .catch(() => {});
    }
    clearAuth();
  }, [clearAuth]);

  const isAdmin = user?.role === 'ADMIN';

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, login, register, logout, loading }}>
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
