import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

/**
 * Floating AI chatbot widget. Talks only to the existing /api/chat route
 * (Ollama running locally behind it) — no RAG, no embeddings, no vector
 * store, nothing stored server-side. Conversation history lives in this
 * component's state only and is resent with each request so the model has
 * turn-by-turn context.
 *
 * `seed` (optional): { text, context, nonce } — when `nonce` changes, the
 * widget opens itself, attaches `context` (e.g. a reconciliation report) to
 * the conversation, and immediately sends `text` as the first question.
 * This is how the "Ask AI about this report" button in App.jsx hands off
 * to the chatbot.
 */
export default function ChatWidget({ apiBase, seed }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant' | 'error', content }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [reportContext, setReportContext] = useState(null);
  const lastSeedNonce = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  useEffect(() => {
    if (!seed || seed.nonce === lastSeedNonce.current) return;
    lastSeedNonce.current = seed.nonce;
    setReportContext(seed.context || null);
    setOpen(true);
    if (seed.text) {
      sendMessage(seed.text, seed.context || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const sendMessage = async (text, contextOverride) => {
    const trimmed = (text || '').trim();
    if (!trimmed || sending) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const res = await axios.post(`${apiBase}/api/chat`, {
        message: trimmed,
        context: contextOverride !== undefined ? contextOverride : reportContext,
        history: nextMessages
          .slice(0, -1)
          .map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data?.response || '(empty response)' }]);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Could not reach the local AI (Ollama). Is it running and is the model pulled?';
      setMessages((prev) => [...prev, { role: 'error', content: msg }]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearChat = () => {
    setMessages([]);
    setReportContext(null);
  };

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
          <div className="chat-widget-header">
            <div>
              <strong>AI Assistant</strong>
              <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                Local model via Ollama
              </span>
            </div>
            <div className="chat-widget-header-actions">
              <button type="button" className="secondary chat-clear-btn" onClick={clearChat} title="Clear conversation">
                Clear
              </button>
              <button type="button" className="secondary chat-close-btn" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
          </div>

          {reportContext && (
            <div className="chat-context-pill">📎 A reconciliation report is attached to this conversation</div>
          )}

          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="chat-empty-hint">
                Ask me anything about your reconciliation reports — e.g. "What changed between these files?"
                or "Summarize this report for my manager."
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">Thinking…</div>
            )}
          </div>

          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
