import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { authHeaders } from './AuthContext';

/**
 * Floating AI chatbot widget — dataset-aware, auth-aware.
 *
 * Changes from the original:
 *  - Accepts a `token` prop (JWT string from App.jsx) and attaches it as a
 *    Bearer Authorization header on every API call, so the backend can
 *    enforce ownership: the user only ever sees their own datasets, and the
 *    chat route will refuse to answer about another user's dataset.
 *  - The dataset dropdown is fed by `seriesList` which App.jsx already
 *    filters to the authenticated user's own series — nothing extra needed
 *    here beyond forwarding the token on the /api/series/<id> fetch that
 *    loads version options.
 *  - All other behaviour (seed auto-open, version picker, conversation
 *    history, Ollama error handling) is unchanged.
 *
 * Props:
 *   apiBase      (string)  — base URL, e.g. http://localhost:5000
 *   seed         (object)  — { seriesId, version, text, nonce } from App.jsx
 *   seriesList   (array)   — already user-scoped list from App.jsx
 *   token        (string)  — JWT access token; null when unauthenticated
 */
export default function ChatWidget({ apiBase, seed, seriesList = [], token }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [versionOptions, setVersionOptions] = useState([]);
  const [datasetLoading, setDatasetLoading] = useState(false);

  const lastSeedNonce = useRef(null);
  const scrollRef = useRef(null);

  // Auto-scroll to the latest message whenever the list changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  // ── Load version list for a dataset ─────────────────────────────────────
  // Attaches the JWT so the backend ownership guard is satisfied.
  const loadVersionsFor = async (seriesId, preferredVersion) => {
    if (!seriesId) {
      setVersionOptions([]);
      setSelectedVersion(null);
      return;
    }
    setDatasetLoading(true);
    try {
      const res = await axios.get(
        `${apiBase}/api/series/${seriesId}`,
        { headers: authHeaders(token) },
      );
      const versions = res.data?.series?.versions || [];
      const diffVersions = versions.filter((v) => v.version > 0);
      setVersionOptions(diffVersions.map((v) => ({ version: v.version, label: v.label })));
      if (preferredVersion !== undefined && preferredVersion !== null) {
        setSelectedVersion(preferredVersion);
      } else if (diffVersions.length) {
        setSelectedVersion(diffVersions[diffVersions.length - 1].version);
      } else {
        setSelectedVersion(0);
      }
    } catch {
      setVersionOptions([]);
      setSelectedVersion(null);
    } finally {
      setDatasetLoading(false);
    }
  };

  const handleSelectSeries = (seriesId) => {
    setSelectedSeriesId(seriesId);
    setMessages([]);
    loadVersionsFor(seriesId);
  };

  // ── Seed (triggered by "Ask AI about this report" button in App.jsx) ─────
  useEffect(() => {
    if (!seed || seed.nonce === lastSeedNonce.current) return;
    lastSeedNonce.current = seed.nonce;
    setOpen(true);
    setMessages([]);
    setSelectedSeriesId(seed.seriesId || '');
    if (seed.seriesId) {
      loadVersionsFor(seed.seriesId, seed.version).then(() => {
        if (seed.text) sendMessage(seed.text, seed.seriesId, seed.version);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // ── Send a message ────────────────────────────────────────────────────────
  const sendMessage = async (text, seriesIdOverride, versionOverride) => {
    const trimmed = (text || '').trim();
    const seriesId = seriesIdOverride !== undefined ? seriesIdOverride : selectedSeriesId;
    const version  = versionOverride  !== undefined ? versionOverride  : selectedVersion;
    if (!trimmed || sending) return;

    if (!seriesId) {
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: 'Please select a dataset before asking questions.' },
      ]);
      return;
    }

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const res = await axios.post(
        `${apiBase}/api/chat`,
        {
          message: trimmed,
          series_id: seriesId,
          version,
          // Resend prior turns so the model has conversation context.
          // Slice to the last 20 turns max to keep the payload bounded.
          history: nextMessages
            .slice(0, -1)
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content })),
        },
        { headers: authHeaders(token) },
      );
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data?.response || '(empty response)' },
      ]);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        'Could not reach the local AI (Ollama). Is it running and is the model pulled?';
      setMessages((prev) => [...prev, { role: 'error', content: msg }]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearChat = () => setMessages([]);

  const selectedSeries = seriesList.find((s) => s.series_id === selectedSeriesId);
  const canAsk = Boolean(selectedSeriesId) && !datasetLoading;

  return (
    <>
      <button
        type="button"
        className="chat-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {open ? '✕' : '🤖'}
      </button>

      {open && (
        <div className="chat-widget">
          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="chat-widget-header">
            <div>
              <strong>AI Assistant</strong>
              <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                Local model via Ollama · dataset reconciliation only
              </span>
            </div>
            <div className="chat-widget-header-actions">
              <button
                type="button"
                className="secondary chat-clear-btn"
                onClick={clearChat}
                title="Clear conversation"
              >
                Clear
              </button>
              <button
                type="button"
                className="secondary chat-close-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── Dataset + version pickers ────────────────────────────── */}
          <div
            className="chat-dataset-picker"
            style={{ padding: '0.5rem 0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            {/* Dataset dropdown — seriesList is already filtered to the
                authenticated user's own datasets by App.jsx, so users can
                never even see another user's dataset name here. */}
            <select
              className="series-select"
              value={selectedSeriesId}
              onChange={(e) => handleSelectSeries(e.target.value)}
              style={{ flex: '1 1 auto', minWidth: 0 }}
            >
              <option value="">Select a dataset…</option>
              {seriesList.map((s) => (
                <option key={s.series_id} value={s.series_id}>
                  {s.name}
                </option>
              ))}
            </select>

            {/* Version picker — only shown when the selected dataset has
                at least one comparison (version > 0). */}
            {versionOptions.length > 0 && (
              <select
                value={selectedVersion ?? ''}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
                style={{ flex: '0 0 auto' }}
              >
                {versionOptions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── Context pill ─────────────────────────────────────────── */}
          {selectedSeries && (
            <div className="chat-context-pill">
              📎 Asking about &ldquo;{selectedSeries.name}&rdquo;
              {versionOptions.length === 0 && ' — baseline only, no comparison run yet'}
            </div>
          )}

          {/* ── Message list ─────────────────────────────────────────── */}
          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && !selectedSeriesId && (
              <p className="chat-empty-hint">
                Please select a dataset above before asking questions. Once selected, ask things
                like &ldquo;How many unmatched records are there?&rdquo; or &ldquo;Which columns
                have the highest mismatch?&rdquo;
              </p>
            )}
            {messages.length === 0 && selectedSeriesId && (
              <p className="chat-empty-hint">
                Ask me anything about this dataset&rsquo;s reconciliation report — e.g.
                &ldquo;Summarize this dataset&rdquo; or &ldquo;What changed between these
                files?&rdquo;
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">
                Thinking…
              </div>
            )}
          </div>

          {/* ── Input row ────────────────────────────────────────────── */}
          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={canAsk ? 'Type a message…' : 'Select a dataset first…'}
              disabled={sending || !canAsk}
            />
            <button type="submit" disabled={sending || !canAsk || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
