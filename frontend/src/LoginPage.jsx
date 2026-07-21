/**
 * LoginPage — full-screen login / register experience.
 *
 * Rendered by App.jsx whenever the user is not authenticated.
 * On success the AuthContext token is set and App.jsx automatically
 * unmounts this component and shows the dashboard.
 *
 * Visual layer only — all auth logic (mode, validation, submit) is
 * unchanged from the original implementation.
 */

import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { login, register } = useAuth();

  // 'login' | 'register'
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [focusedField, setFocusedField] = useState('');

  const resetForm = (newMode) => {
    setMode(newMode);
    setError('');
    setFullName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimName = fullName.trim();
    const trimEmail = email.trim();
    const trimPass = password.trim();

    if (mode === 'register' && !trimName) {
      setError('Full name is required.');
      return;
    }

    if (!trimEmail || !trimPass) {
      setError('Email and password are required.');
      return;
    }

    if (mode === 'register') {
      if (trimPass !== confirmPassword.trim()) {
        setError('Passwords do not match.');
        return;
      }
      if (trimPass.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }

    setSubmitting(true);
    const result = mode === 'login'
      ? await login(trimEmail, trimPass)
      : await register(trimName, trimEmail, trimPass);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
    }
    // On success AuthContext updates token/user → App.jsx replaces this page automatically.
  };

  const isRegister = mode === 'register';

  return (
    <div className="auth-shell">
      {/* Ambient background */}
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />
      <div className="auth-grid-overlay" />

      <div className="auth-layout">
        {/* ── Left: brand / value panel ─────────────────────────────── */}
        <div className="auth-showcase">
          <div className="auth-showcase-inner">
            <div className="auth-brand-row">
              <div className="auth-logo-badge">
                <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
                  <circle cx="15" cy="15" r="10" stroke="#fff" strokeWidth="3" fill="none" />
                  <circle cx="25" cy="25" r="10" stroke="#fff" strokeWidth="3" fill="none" opacity="0.75" />
                </svg>
              </div>
              <span className="auth-brand-name">Reconciliation</span>
            </div>

            <h1 className="auth-showcase-title">
              Your data,<br />perfectly in sync.
            </h1>
            <p className="auth-showcase-sub">
              AI-powered reconciliation, EDA, and time-series insight — all in one calm, focused workspace.
            </p>

            <ul className="auth-feature-list">
              {[
                'AI-assisted reconciliation in seconds',
                'Automatic duplicate & anomaly detection',
                'Beautiful, exportable reports',
              ].map((f) => (
                <li key={f}>
                  <span className="auth-feature-check">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5L6.2 11.5L13 4.5" stroke="#0a0f25" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Right: auth card ──────────────────────────────────────── */}
        <div className="auth-form-side">
          <div className="auth-card">
            <div className="auth-card-glow" />

            {/* Mobile-only brand */}
            <div className="auth-brand-row auth-brand-row-mobile">
              <div className="auth-logo-badge auth-logo-badge-sm">
                <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
                  <circle cx="15" cy="15" r="10" stroke="#fff" strokeWidth="3" fill="none" />
                  <circle cx="25" cy="25" r="10" stroke="#fff" strokeWidth="3" fill="none" opacity="0.75" />
                </svg>
              </div>
              <span className="auth-brand-name">Reconciliation</span>
            </div>

            <div className="auth-card-heading">
              <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
              <p>{isRegister ? 'Start reconciling your data in minutes.' : 'Sign in to continue to your workspace.'}</p>
            </div>

            {/* ── Sliding tabs ─────────────────────────────────────── */}
            <div className="auth-tabs" role="tablist">
              <div className={`auth-tabs-indicator ${isRegister ? 'is-register' : ''}`} />
              <button
                type="button"
                role="tab"
                aria-selected={!isRegister}
                className={`auth-tab ${!isRegister ? 'active' : ''}`}
                onClick={() => resetForm('login')}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isRegister}
                className={`auth-tab ${isRegister ? 'active' : ''}`}
                onClick={() => resetForm('register')}
              >
                Create Account
              </button>
            </div>

            {/* ── Form ─────────────────────────────────────────────── */}
            <form onSubmit={handleSubmit} className="auth-form" autoComplete="on">
              {isRegister && (
                <label className={`auth-field ${focusedField === 'fullName' ? 'is-focused' : ''}`}>
                  <span className="auth-field-label">Full Name</span>
                  <span className="auth-input-wrap">
                    <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M4.5 20.2c1.4-3.4 4.4-5.2 7.5-5.2s6.1 1.8 7.5 5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder="e.g. Alice Smith"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      onFocus={() => setFocusedField('fullName')}
                      onBlur={() => setFocusedField('')}
                      disabled={submitting}
                      required
                    />
                  </span>
                </label>
              )}

              <label className={`auth-field ${focusedField === 'email' ? 'is-focused' : ''}`}>
                <span className="auth-field-label">Email</span>
                <span className="auth-input-wrap">
                  <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M4.5 7l7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="e.g. alice@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField('')}
                    disabled={submitting}
                    required
                  />
                </span>
              </label>

              <label className={`auth-field ${focusedField === 'password' ? 'is-focused' : ''}`}>
                <span className="auth-field-label">Password</span>
                <span className="auth-input-wrap">
                  <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M8 10.5V7.8a4 4 0 1 1 8 0v2.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField('')}
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    className="auth-eye-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.7a2.5 2.5 0 0 0 3.5 3.4M6.6 6.7C4.5 8.1 3 10 3 12c0 0 3 6.5 9 6.5 1.7 0 3.2-.5 4.4-1.2M9.9 5.6A9.9 9.9 0 0 1 12 5.4c6 0 9 6.6 9 6.6a13.4 13.4 0 0 1-2.6 3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12s3-6.5 9-6.5 9 6.5 9 6.5-3 6.5-9 6.5-9-6.5-9-6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" /></svg>
                    )}
                  </button>
                </span>
              </label>

              {isRegister && (
                <label className={`auth-field ${focusedField === 'confirm' ? 'is-focused' : ''}`}>
                  <span className="auth-field-label">Confirm Password</span>
                  <span className="auth-input-wrap">
                    <svg className="auth-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M8 10.5V7.8a4 4 0 1 1 8 0v2.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onFocus={() => setFocusedField('confirm')}
                      onBlur={() => setFocusedField('')}
                      disabled={submitting}
                      required
                    />
                    <button
                      type="button"
                      className="auth-eye-btn"
                      onClick={() => setShowConfirm((v) => !v)}
                      tabIndex={-1}
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      {showConfirm ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.7a2.5 2.5 0 0 0 3.5 3.4M6.6 6.7C4.5 8.1 3 10 3 12c0 0 3 6.5 9 6.5 1.7 0 3.2-.5 4.4-1.2M9.9 5.6A9.9 9.9 0 0 1 12 5.4c6 0 9 6.6 9 6.6a13.4 13.4 0 0 1-2.6 3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12s3-6.5 9-6.5 9 6.5 9 6.5-3 6.5-9 6.5-9-6.5-9-6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" /></svg>
                      )}
                    </button>
                  </span>
                </label>
              )}

              {error && (
                <div className="auth-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M12 8v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="16" r="1" fill="currentColor" /></svg>
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={submitting}>
                <span className="auth-submit-label">
                  {submitting && <span className="auth-spinner" />}
                  {submitting
                    ? (isRegister ? 'Creating account…' : 'Signing in…')
                    : (isRegister ? 'Create Account' : 'Sign In')}
                  {!submitting && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="auth-submit-arrow"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
              </button>
            </form>

            <p className="auth-switch-hint">
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
              <button type="button" className="auth-switch-link" onClick={() => resetForm(isRegister ? 'login' : 'register')}>
                {isRegister ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* ── Styles ─────────────────────────────────────────────────── */}
      <style>{`
        .auth-shell {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
          background: radial-gradient(1200px 600px at 15% -10%, rgba(79,70,229,0.25), transparent),
                      radial-gradient(900px 500px at 100% 100%, rgba(6,182,212,0.18), transparent),
                      linear-gradient(135deg, #0a0f25 0%, #0f172a 55%, #171b3a 100%);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
        }

        .auth-grid-overlay {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 46px 46px;
          -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 20%, #000 40%, transparent 90%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 20%, #000 40%, transparent 90%);
          pointer-events: none;
        }

        .auth-blob { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.45; animation: authFloat 9s ease-in-out infinite; pointer-events: none; }
        .auth-blob-1 { width: 420px; height: 420px; background: #4F46E5; top: -10%; left: -6%; }
        .auth-blob-2 { width: 380px; height: 380px; background: #06B6D4; bottom: -12%; right: -6%; animation-delay: -3s; }
        .auth-blob-3 { width: 300px; height: 300px; background: #8B5CF6; top: 45%; left: 55%; animation-delay: -6s; }

        @keyframes authFloat {
          0%, 100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(25px,-25px) scale(1.08); }
        }

        .auth-layout {
          position: relative;
          z-index: 1;
          display: flex;
          width: 100%;
          min-height: 100vh;
        }

        /* ── Left showcase panel ─────────────────────────────────── */
        .auth-showcase {
          flex: 1.05;
          display: flex;
          align-items: center;
          padding: 4rem 4.5rem;
          position: relative;
        }
        .auth-showcase::after {
          content: '';
          position: absolute;
          top: 12%;
          bottom: 12%;
          right: 0;
          width: 1px;
          background: linear-gradient(180deg, transparent, rgba(255,255,255,0.14), transparent);
        }
        .auth-showcase-inner { max-width: 480px; animation: authSlideUp 0.7s ease both; }

        .auth-brand-row { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 2.5rem; }
        .auth-brand-row-mobile { display: none; margin-bottom: 1.75rem; }
        .auth-logo-badge {
          width: 42px; height: 42px; border-radius: 12px;
          background: linear-gradient(135deg, #4F46E5, #06B6D4);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(79,70,229,0.4);
        }
        .auth-logo-badge-sm { width: 34px; height: 34px; border-radius: 10px; }
        .auth-brand-name { font-size: 1.2rem; font-weight: 800; color: #fff; letter-spacing: -0.01em; }

        .auth-showcase-title {
          font-size: 2.6rem;
          font-weight: 800;
          line-height: 1.16;
          color: #fff;
          margin: 0 0 1rem;
          letter-spacing: -0.02em;
        }
        .auth-showcase-sub { font-size: 1.05rem; line-height: 1.65; color: #b3bdd4; margin: 0 0 2.25rem; max-width: 420px; }

        .auth-feature-list { list-style: none; margin: 0 0 2.5rem; padding: 0; display: flex; flex-direction: column; gap: 0.85rem; }
        .auth-feature-list li { display: flex; align-items: center; gap: 0.75rem; color: #dbe3f5; font-size: 0.98rem; font-weight: 500; }
        .auth-feature-check {
          flex-shrink: 0; width: 22px; height: 22px; border-radius: 999px;
          background: linear-gradient(135deg, #06B6D4, #22d3ee);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(6,182,212,0.35);
        }

        /* ── Right form panel ─────────────────────────────────────── */
        .auth-form-side {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2.5rem 1.5rem;
        }

        .auth-card {
          position: relative;
          width: 100%;
          max-width: 430px;
          background: rgba(15, 20, 40, 0.55);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 24px;
          padding: 2.6rem 2.3rem;
          box-shadow: 0 25px 70px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
          animation: authSlideUp 0.7s ease 0.1s both;
          overflow: hidden;
        }

        .auth-card-glow {
          position: absolute;
          top: -60%; left: 50%;
          width: 340px; height: 340px;
          background: radial-gradient(circle, rgba(79,70,229,0.35), transparent 70%);
          transform: translateX(-50%);
          pointer-events: none;
        }

        .auth-card-heading { position: relative; margin-bottom: 1.6rem; }
        .auth-card-heading h2 { margin: 0 0 0.4rem; font-size: 1.55rem; font-weight: 800; color: #fff; letter-spacing: -0.01em; }
        .auth-card-heading p { margin: 0; color: #96a2ba; font-size: 0.92rem; }

        .auth-tabs {
          position: relative;
          display: flex;
          gap: 0;
          margin-bottom: 1.9rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 4px;
        }
        .auth-tabs-indicator {
          position: absolute;
          top: 4px; bottom: 4px; left: 4px;
          width: calc(50% - 4px);
          border-radius: 9px;
          background: linear-gradient(135deg, #4F46E5, #06B6D4);
          box-shadow: 0 6px 18px rgba(79,70,229,0.4);
          transition: transform 0.32s cubic-bezier(.65,0,.35,1);
        }
        .auth-tabs-indicator.is-register { transform: translateX(100%); }
        .auth-tab {
          position: relative; z-index: 1;
          flex: 1; padding: 0.6rem 0;
          border: none; background: transparent;
          color: #9aa5bd; font-weight: 600; font-size: 0.9rem;
          cursor: pointer; border-radius: 9px;
          transition: color 0.25s;
        }
        .auth-tab.active { color: #fff; }

        .auth-form { display: flex; flex-direction: column; gap: 1.15rem; }
        .auth-field { display: flex; flex-direction: column; gap: 0.45rem; }
        .auth-field-label {
          font-size: 0.74rem; font-weight: 700; color: #8b96b3;
          letter-spacing: 0.06em; text-transform: uppercase;
        }
        .auth-input-wrap {
          position: relative;
          display: flex; align-items: center;
          border-radius: 11px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.045);
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .auth-field.is-focused .auth-input-wrap {
          border-color: rgba(6,182,212,0.55);
          box-shadow: 0 0 0 4px rgba(6,182,212,0.14);
          background: rgba(255,255,255,0.065);
        }
        .auth-input-icon { flex-shrink: 0; margin-left: 0.85rem; color: #7c88a6; transition: color 0.2s; }
        .auth-field.is-focused .auth-input-icon { color: #06B6D4; }
        .auth-input-wrap input {
          flex: 1; min-width: 0;
          padding: 0.72rem 0.75rem;
          border: none; background: transparent; outline: none;
          color: #f1f5f9; font-size: 0.98rem;
        }
        .auth-input-wrap input::placeholder { color: #5c6784; }
        .auth-eye-btn {
          flex-shrink: 0; margin-right: 0.5rem;
          background: transparent; border: none; color: #7c88a6;
          cursor: pointer; padding: 0.3rem; display: flex; border-radius: 6px;
          transition: color 0.2s, background 0.2s;
        }
        .auth-eye-btn:hover { color: #dbe3f5; background: rgba(255,255,255,0.06); }

        .auth-error {
          display: flex; align-items: center; gap: 0.55rem;
          background: rgba(239,68,68,0.12);
          border: 1px solid rgba(239,68,68,0.35);
          border-radius: 10px;
          padding: 0.65rem 0.9rem;
          color: #fca5a5;
          font-size: 0.85rem;
          animation: authShake 0.4s ease;
        }

        @keyframes authShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        .auth-submit {
          position: relative;
          margin-top: 0.3rem;
          padding: 0.85rem;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%);
          background-size: 160% 160%;
          color: #fff;
          font-weight: 700;
          font-size: 0.98rem;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.25s, box-shadow 0.25s, background-position 0.5s;
          box-shadow: 0 10px 30px rgba(79,70,229,0.35);
        }
        .auth-submit:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 16px 40px rgba(79,70,229,0.5);
          background-position: 100% 0;
        }
        .auth-submit:active:not(:disabled) { transform: translateY(0); }
        .auth-submit:disabled { opacity: 0.7; cursor: not-allowed; }
        .auth-submit-label { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .auth-submit-arrow { transition: transform 0.25s; }
        .auth-submit:hover:not(:disabled) .auth-submit-arrow { transform: translateX(4px); }

        .auth-spinner {
          width: 15px; height: 15px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: authSpin 0.7s linear infinite;
        }
        @keyframes authSpin { to { transform: rotate(360deg); } }

        .auth-switch-hint { margin-top: 1.5rem; text-align: center; font-size: 0.88rem; color: #8b96b3; }
        .auth-switch-link {
          background: none; border: none; color: #22d3ee; font-weight: 700;
          cursor: pointer; padding: 0; font-size: inherit;
        }
        .auth-switch-link:hover { text-decoration: underline; }

        @keyframes authSlideUp {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 980px) {
          .auth-showcase { display: none; }
          .auth-brand-row-mobile { display: flex; justify-content: center; }
          .auth-form-side { flex: 1; padding: 3rem 1.25rem; }
        }

        @media (max-width: 480px) {
          .auth-card { padding: 2rem 1.4rem; border-radius: 18px; }
        }
      `}</style>
    </div>
  );
}
