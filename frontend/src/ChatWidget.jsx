import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { authHeaders } from './AuthContext';

// Free Groq models offered in the model picker. Label/badge are used to
// render the engine line in the header (e.g. "Auto · Meta · Best overall").
const GROQ_MODELS = [
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', badge: 'OpenAI' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', badge: 'OpenAI' },
  { id: 'llama-3.3-70b-versatile', label: 'Best overall', badge: 'Meta' },
  { id: 'llama-3.1-8b-instant', label: 'Fastest', badge: 'Meta' },
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B', badge: 'Qwen' },
  { id: 'groq/compound-mini', label: 'Compound Mini', badge: 'Groq' },
];

const SUGGESTIONS = [
  'Summarize this reconciliation',
  'How many records are unmatched?',
  'Which columns have the most mismatches?',
  'What changed between the versions?',
];

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

  const [provider, setProvider] = useState('auto');
  const [groqModel, setGroqModel] = useState('llama-3.3-70b-versatile');

  // ── Voice assistant state ────────────────────────────────────────────────
  // Purely additive: uses the browser's built-in Web Speech API for both
  // speech-to-text (SpeechRecognition) and text-to-speech (SpeechSynthesis).
  // No backend/API changes — transcribed text is passed into the existing
  // sendMessage() function exactly as if it had been typed.
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true); // toggle: speak AI replies aloud
  const [voiceError, setVoiceError] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);

  const lastSeedNonce = useRef(null);
  const scrollRef = useRef(null);
  const sendMessageRef = useRef(null); // always points at the latest sendMessage closure

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

  // ── Speech-to-text setup (Web Speech API) ───────────────────────────────
  // Initialised once on mount. Falls back gracefully if the browser doesn't
  // support SpeechRecognition (e.g. Firefox) — the mic button is hidden and
  // typing keeps working exactly as before.
  useEffect(() => {
    const SpeechRecognitionImpl =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionImpl) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceError('');
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        // Route through the ref, not a direct closure over sendMessage.
        // The recognition object (and its handlers) are created once on
        // mount, so calling sendMessage directly here would freeze on the
        // dataset/version/provider/history state from that first render.
        // sendMessageRef.current is refreshed every render (see effect
        // below), so this always uses whatever is currently selected.
        sendMessageRef.current?.(transcript);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setVoiceError('Microphone access was denied. Please allow microphone permission and try again.');
      } else if (event.error === 'no-speech') {
        setVoiceError("Didn't catch that — please try again.");
      } else if (event.error === 'audio-capture') {
        setVoiceError('No microphone was found. Please check your device.');
      } else {
        setVoiceError('Voice input error: ' + event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // no-op — recognition may already be stopped
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Text-to-speech playback ─────────────────────────────────────────────
  const speak = (text) => {
    if (!voiceEnabled || !text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // stop any prior utterance before speaking the new one
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis failing should never break the chat itself.
    }
  };

  const startListening = () => {
    if (!recognitionRef.current || isListening || sending || !canAsk) return;
    setVoiceError('');
    try {
      window.speechSynthesis?.cancel(); // don't talk over the mic
      recognitionRef.current.start();
    } catch {
      // start() throws if already started — ignore, onstart/onerror handle state
    }
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {
      // no-op
    }
  };

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
          provider,
          model: provider === 'ollama' ? undefined : groqModel,
          // Resend prior turns so the model has conversation context.
          // Slice to the last 20 turns max to keep the payload bounded.
          history: nextMessages
            .slice(0, -1)
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content })),
        },
        { headers: authHeaders(token) },
      );

      let replyText = '(empty response)';
      let note = null;

      if (res.data?.async && res.data?.job_id) {
        const asyncJobId = res.data.job_id;
        let isDone = false;
        let attempts = 0;
        while (!isDone && attempts < 90) {
          await new Promise((r) => setTimeout(r, 800));
          attempts++;
          const statusRes = await axios.get(
            `${apiBase}/api/jobs/${asyncJobId}/status`,
            { headers: authHeaders(token) }
          );
          const jobData = statusRes.data;

          if (jobData?.status === 'COMPLETED' && jobData?.result_summary) {
            const summary = jobData.result_summary;
            replyText = summary.response || '(empty response)';
            note = summary.note || null;
            isDone = true;
            break;
          } else if (jobData?.status === 'FAILED') {
            throw new Error(jobData.error_message || 'Kafka chatbot response generation failed.');
          }
        }
        if (!isDone) {
          throw new Error('Chatbot request timed out in Kafka.');
        }
      } else {
        replyText = res.data?.response || '(empty response)';
        note = res.data?.note || null;
      }

      setMessages((prev) => [
        ...prev,
        ...(note ? [{ role: 'system', content: note }] : []),
        { role: 'assistant', content: replyText },
      ]);
      // Read the AI's answer aloud if voice responses are enabled.
      speak(replyText);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        'Could not reach the AI provider. Is GROQ_API_KEY set, and is the local Ollama running?';
      setMessages((prev) => [...prev, { role: 'error', content: msg }]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Keep the ref pointed at this render's sendMessage so the mic's
  // recognition.onresult handler (registered once on mount) never calls a
  // stale closure — it always sees the latest selectedSeriesId, version,
  // provider, model, and message history.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  const clearChat = () => setMessages([]);

  const selectedSeries = seriesList.find((s) => s.series_id === selectedSeriesId);
  const canAsk = Boolean(selectedSeriesId) && !datasetLoading;

  const activeGroqModel = GROQ_MODELS.find((m) => m.id === groqModel);
  const engineLabel =
    provider === 'ollama'
      ? 'Ollama · local model'
      : provider === 'groq'
        ? `Groq · ${activeGroqModel?.badge} · ${activeGroqModel?.label}`
        : `Auto · ${activeGroqModel?.badge} · ${activeGroqModel?.label} → Ollama fallback`;

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
            <div className="chat-widget-title">
              <div className="chat-avatar">🤖</div>
              <div>
                <strong>AI Assistant</strong>
                <span className="chat-engine-line">
                  {engineLabel} · reconciliation only
                </span>
              </div>
            </div>
            <div className="chat-widget-header-actions">
              <button
                type="button"
                onClick={() => {
                  setVoiceEnabled((v) => {
                    const next = !v;
                    if (!next) window.speechSynthesis?.cancel();
                    return next;
                  });
                }}
                title={voiceEnabled ? 'Voice responses on — click to mute' : 'Voice responses off — click to enable'}
                aria-label={voiceEnabled ? 'Disable voice responses' : 'Enable voice responses'}
                aria-pressed={voiceEnabled}
              >
                {voiceEnabled ? '🔊' : '🔇'}
              </button>
              <button
                type="button"
                onClick={clearChat}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                ↺
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── Dataset + version pickers ────────────────────────────── */}
          <div className="chat-dataset-picker">
            {/* Dataset dropdown — seriesList is already filtered to the
                authenticated user's own datasets by App.jsx, so users can
                never even see another user's dataset name here. */}
            <select
              className="chat-select"
              value={selectedSeriesId}
              onChange={(e) => handleSelectSeries(e.target.value)}
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
                className="chat-select"
                value={selectedVersion ?? ''}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
              >
                {versionOptions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── Provider + model pickers ─────────────────────────────── */}
          <div className="chat-provider-picker">
            <select
              className="chat-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="auto">⚡ Auto — Groq → Ollama</option>
              <option value="groq">Groq</option>
              <option value="ollama">Ollama</option>
            </select>
            {provider !== 'ollama' && (
              <select
                className="chat-select"
                value={groqModel}
                onChange={(e) => setGroqModel(e.target.value)}
              >
                {GROQ_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
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
            {messages.length === 0 && (
              <div className="chat-empty">
                <div className="chat-empty-icon">🤖</div>
                <p>
                  {selectedSeriesId
                    ? 'Ask me anything about this reconciliation report.'
                    : 'Select a dataset above, then ask anything about its reconciliation report.'}
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
          </div>

          {/* ── Voice status banners ─────────────────────────────────── */}
          {isListening && (
            <div className="chat-voice-status chat-voice-listening">
              <span className="chat-voice-dot" />
              Listening…
            </div>
          )}
          {voiceError && !isListening && (
            <div className="chat-voice-status chat-voice-error">
              {voiceError}
            </div>
          )}

          {/* ── Input row ────────────────────────────────────────────── */}
          <form className="chat-input-row" onSubmit={handleSubmit}>
            {speechSupported && (
              <button
                type="button"
                className={`chat-mic-btn${isListening ? ' chat-mic-btn-active' : ''}`}
                onClick={isListening ? stopListening : startListening}
                disabled={sending || !canAsk}
                title={isListening ? 'Stop listening' : 'Speak your message'}
                aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                aria-pressed={isListening}
              >
                {isListening ? '⏹' : '🎤'}
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isListening
                  ? 'Listening…'
                  : canAsk
                    ? 'Type a message…'
                    : 'Select a dataset first…'
              }
              disabled={sending || !canAsk}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={sending || !canAsk || !input.trim()}
            >
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  );
}
