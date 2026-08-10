import { useState, useRef } from 'react';
import axios from 'axios';
const REQUIRED_FIELDS = ['TxnNumber', 'Amount'];
const WARN_CONFIDENCE = 0.85;

function MappingTable({ title, mapping }) {
  if (!mapping?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>{title}</div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Canonical Field</th>
              <th>Matched Column</th>
              <th>Method</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((row) => {
              const isNotFound = row.method === 'NOT_FOUND';
              const isLowConf = !isNotFound && row.confidence < WARN_CONFIDENCE && row.method === 'fuzzy_match';
              return (
                <tr key={row.field} style={isNotFound ? { background: 'rgba(239,68,68,0.08)' } : isLowConf ? { background: 'rgba(245,158,11,0.07)' } : {}}>
                  <td style={{ fontWeight: 600 }}>{row.field}</td>
                  <td>{row.matched_to ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>not found</span>}</td>
                  <td>
                    <span className={`status-badge ${
                      row.method === 'manual_override' ? 'status-matched' :
                      row.method === 'exact_synonym' ? 'status-matched' :
                      row.method === 'fuzzy_match' ? 'status-updated' :
                      'status-deleted'
                    }`}>{row.method}</span>
                  </td>
                  <td>
                    {isNotFound
                      ? <span style={{ color: '#ef4444' }}>—</span>
                      : <span style={{ color: isLowConf ? '#f59e0b' : '#22c55e' }}>{(row.confidence * 100).toFixed(0)}%</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryPanel({ summary }) {
  if (!summary) return null;
  const tiles = [
    ['Source Records', summary.source_records],
    ['Target Records', summary.target_records],
    ['Matched', summary.matched, '#22c55e'],
    ['Amount Mismatch', summary.amount_mismatch, '#ef4444'],
    ['Only in Source', summary.only_in_source, '#f59e0b'],
    ['Only in Target', summary.only_in_target, '#3b82f6'],
    ['Tier-2 Matches', summary.tier2_matches, '#a855f7'],
    ['Duplicate Keys (Src)', summary.duplicate_keys_source, '#f59e0b'],
    ['Duplicate Keys (Tgt)', summary.duplicate_keys_target, '#f59e0b'],
    ['Exceptions (Src)', summary.source_exceptions, '#94a3b8'],
    ['Exceptions (Tgt)', summary.target_exceptions, '#94a3b8'],
  ];
  return (
    <div className="cards" style={{ marginBottom: 20 }}>
      {tiles.map(([label, value, color]) => (
        <div key={label} className="card" style={color ? { borderTop: `3px solid ${color}` } : {}}>
          <h3>{label}</h3>
          <p style={{ color: color || 'var(--text)', fontSize: '1.4rem', fontWeight: 700 }}>{value ?? 0}</p>
        </div>
      ))}
      {summary.source_total != null && (
        <div className="card" style={{ borderTop: '3px solid var(--primary)' }}>
          <h3>Source Total</h3>
          <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{summary.source_total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      )}
      {summary.target_total != null && (
        <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
          <h3>Target Total</h3>
          <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{summary.target_total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      )}
      {summary.net_diff != null && (
        <div className="card" style={{ borderTop: `3px solid ${Math.abs(summary.net_diff) <= summary.tolerance ? '#22c55e' : '#ef4444'}` }}>
          <h3>Net Diff</h3>
          <p style={{ fontSize: '1.1rem', fontWeight: 700, color: Math.abs(summary.net_diff) <= summary.tolerance ? '#22c55e' : '#ef4444' }}>
            {summary.net_diff?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
      )}
    </div>
  );
}

function ResultsTable({ rows, columns }) {
  if (!rows?.length) return <p className="muted">No records.</p>;
  const cols = columns || Object.keys(rows[0] || {});
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} style={c === 'Diff' && row[c] != null && Math.abs(row[c]) > 0.01 ? { color: '#ef4444', fontWeight: 600 } : {}}>
                  {row[c] == null ? '' : typeof row[c] === 'number' ? row[c].toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && <p className="muted">Showing first 100 of {rows.length} records.</p>}
    </div>
  );
}

export default function ARReconcileView({ apiBase, token }) {
  const [srcFile, setSrcFile] = useState(null);
  const [tgtFile, setTgtFile] = useState(null);
  const [tolerance, setTolerance] = useState('0.01');
  const [fuzzyCutoff, setFuzzyCutoff] = useState('0.72');

  // Step 1: detection
  const [srcDetection, setSrcDetection] = useState(null);
  const [tgtDetection, setTgtDetection] = useState(null);
  const [detecting, setDetecting] = useState(false);

  // Step 2: mapping review
  const [mappingResult, setMappingResult] = useState(null); // {source_mapping, target_mapping, error, not_found_source, not_found_target}
  const [overrides, setOverrides] = useState({ source: {}, target: {} });
  const [running, setRunning] = useState(false);

  // Step 3: results
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [error, setError] = useState('');

  const srcRef = useRef();
  const tgtRef = useRef();

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const detectType = async (file, setter) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await axios.post(`${apiBase}/api/ar/detect-type`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders },
      });
      setter(res.data);
    } catch {
      setter(null);
    }
  };

  const handleSrcChange = async (file) => {
    setSrcFile(file);
    setSrcDetection(null);
    setMappingResult(null);
    setResults(null);
    if (file) {
      setDetecting(true);
      await detectType(file, setSrcDetection);
      setDetecting(false);
    }
  };

  const handleTgtChange = async (file) => {
    setTgtFile(file);
    setTgtDetection(null);
    setMappingResult(null);
    setResults(null);
    if (file) {
      setDetecting(true);
      await detectType(file, setTgtDetection);
      setDetecting(false);
    }
  };

  const runReconcile = async () => {
    if (!srcFile || !tgtFile) { setError('Please upload both files.'); return; }
    setError('');
    setRunning(true);
    setMappingResult(null);
    setResults(null);
    const fd = new FormData();
    fd.append('source_file', srcFile);
    fd.append('target_file', tgtFile);
    fd.append('tolerance', tolerance);
    fd.append('fuzzy_cutoff', fuzzyCutoff);
    const hasOverrides = Object.keys(overrides.source).length || Object.keys(overrides.target).length;
    if (hasOverrides) fd.append('overrides', JSON.stringify(overrides));
    try {
      const res = await axios.post(`${apiBase}/api/ar/reconcile`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders },
      });
      setMappingResult({ source_mapping: res.data.source_mapping, target_mapping: res.data.target_mapping });
      setResults(res.data.results);
      setActiveTab('summary');
    } catch (err) {
      const data = err.response?.data || {};
      if (data.source_mapping || data.target_mapping) {
        setMappingResult(data);
      }
      setError(data.error || 'Reconciliation failed.');
    } finally {
      setRunning(false);
    }
  };

  const notFoundSrc = mappingResult?.source_mapping?.filter((r) => r.method === 'NOT_FOUND') || [];
  const notFoundTgt = mappingResult?.target_mapping?.filter((r) => r.method === 'NOT_FOUND') || [];
  const hasBlockingNotFound = notFoundSrc.some((r) => REQUIRED_FIELDS.includes(r.field)) || notFoundTgt.some((r) => REQUIRED_FIELDS.includes(r.field));
  const canRun = srcFile && tgtFile && !running && !detecting;

  const DetectionBadge = ({ det }) => {
    if (!det) return null;
    const color = det.type === 'transactional' ? '#22c55e' : det.type === 'master' ? '#3b82f6' : '#f59e0b';
    return (
      <div style={{ marginTop: 6, fontSize: '0.82rem', color }}>
        Detected: <strong>{det.type}</strong> ({(det.confidence * 100).toFixed(0)}% confidence)
        {det.signals?.length > 0 && (
          <ul style={{ margin: '4px 0 0 12px', color: 'var(--muted)', fontSize: '0.78rem' }}>
            {det.signals.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        )}
      </div>
    );
  };

  const TABS = [
    { key: 'summary', label: 'Summary' },
    { key: 'matched', label: `Matched (${results?.summary?.matched ?? 0})` },
    { key: 'mismatch', label: `Amount Mismatch (${results?.summary?.amount_mismatch ?? 0})` },
    { key: 'only_src', label: `Only in Source (${results?.summary?.only_in_source ?? 0})` },
    { key: 'only_tgt', label: `Only in Target (${results?.summary?.only_in_target ?? 0})` },
    { key: 'tier2', label: `Tier-2 Matches (${results?.summary?.tier2_matches ?? 0})` },
    { key: 'duplicates', label: `Duplicate Keys (${(results?.summary?.duplicate_keys_source ?? 0) + (results?.summary?.duplicate_keys_target ?? 0)})` },
    { key: 'exceptions', label: `Exceptions (${(results?.summary?.source_exceptions ?? 0) + (results?.summary?.target_exceptions ?? 0)})` },
    { key: 'mapping', label: 'Column Mapping' },
  ];

  return (
    <div>
      {/* ── Upload & Config ── */}
      <section className="content-card">
        <h2 style={{ marginTop: 0 }}>AR Reconciliation</h2>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Upload Source and Target AR files. Columns are auto-mapped to canonical fields regardless of header naming.
        </p>

        <div className="reconcile-grid">
          <div className="reconcile-left">
            {/* Source file */}
            <label>
              Source File
              <div className="upload-row" style={{ marginTop: 4 }}>
                <input ref={srcRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                  onChange={(e) => handleSrcChange(e.target.files[0] || null)} />
                <button type="button" className="file-input-label" onClick={() => srcRef.current?.click()}>
                  {srcFile ? `📄 ${srcFile.name}` : 'Choose Source File'}
                </button>
              </div>
              {detecting && srcFile && !srcDetection && <span className="muted" style={{ fontSize: '0.8rem' }}>Detecting…</span>}
              <DetectionBadge det={srcDetection} />
              {srcDetection?.type === 'ambiguous' && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, fontSize: '0.82rem', color: '#f59e0b' }}>
                  ⚠ File type is ambiguous — please confirm it is Transactional before proceeding.
                </div>
              )}
            </label>

            {/* Target file */}
            <label style={{ marginTop: 12, display: 'block' }}>
              Target File
              <div className="upload-row" style={{ marginTop: 4 }}>
                <input ref={tgtRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                  onChange={(e) => handleTgtChange(e.target.files[0] || null)} />
                <button type="button" className="file-input-label" onClick={() => tgtRef.current?.click()}>
                  {tgtFile ? `📄 ${tgtFile.name}` : 'Choose Target File'}
                </button>
              </div>
              {detecting && tgtFile && !tgtDetection && <span className="muted" style={{ fontSize: '0.8rem' }}>Detecting…</span>}
              <DetectionBadge det={tgtDetection} />
              {tgtDetection?.type === 'ambiguous' && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, fontSize: '0.82rem', color: '#f59e0b' }}>
                  ⚠ File type is ambiguous — please confirm it is Transactional before proceeding.
                </div>
              )}
            </label>

            {/* Config */}
            <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 140 }}>
                Amount Tolerance ($)
                <input className="search-input" type="number" step="0.01" min="0" value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)} style={{ marginTop: 4 }} />
              </label>
              <label style={{ flex: 1, minWidth: 140 }}>
                Fuzzy Match Cutoff (0–1)
                <input className="search-input" type="number" step="0.01" min="0" max="1" value={fuzzyCutoff}
                  onChange={(e) => setFuzzyCutoff(e.target.value)} style={{ marginTop: 4 }} />
              </label>
            </div>
          </div>

          <aside className="action-frame">
            <button type="button" className="run-btn" onClick={runReconcile} disabled={!canRun}>
              {running ? 'Reconciling…' : 'Run Reconciliation'}
            </button>
            {hasBlockingNotFound && (
              <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#ef4444' }}>
                Required fields not mapped — supply manual overrides below.
              </div>
            )}
          </aside>
        </div>

        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      {/* ── Mapping Review ── */}
      {mappingResult && (
        <section className="content-card result-section">
          <h2>Column Mapping Review</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
            Review how each file's columns were resolved to canonical AR fields.
            Rows highlighted in red are unresolved required fields. Yellow rows are low-confidence fuzzy matches — verify before proceeding.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <MappingTable title="Source File Mapping" mapping={mappingResult.source_mapping} />
            <MappingTable title="Target File Mapping" mapping={mappingResult.target_mapping} />
          </div>

          {/* Manual override inputs for NOT_FOUND fields */}
          {(notFoundSrc.length > 0 || notFoundTgt.length > 0) && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ fontWeight: 600, marginBottom: 10, color: '#ef4444' }}>Manual Overrides — unresolved fields</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {notFoundSrc.map((r) => (
                  <label key={`src-${r.field}`} style={{ fontSize: '0.85rem' }}>
                    Source → {r.field}
                    <input className="search-input" placeholder="Actual column name in source file"
                      value={overrides.source[r.field] || ''}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, source: { ...prev.source, [r.field]: e.target.value } }))}
                      style={{ marginTop: 4 }} />
                  </label>
                ))}
                {notFoundTgt.map((r) => (
                  <label key={`tgt-${r.field}`} style={{ fontSize: '0.85rem' }}>
                    Target → {r.field}
                    <input className="search-input" placeholder="Actual column name in target file"
                      value={overrides.target[r.field] || ''}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, target: { ...prev.target, [r.field]: e.target.value } }))}
                      style={{ marginTop: 4 }} />
                  </label>
                ))}
              </div>
              <button type="button" className="run-btn" style={{ marginTop: 12 }} onClick={runReconcile} disabled={running}>
                {running ? 'Reconciling…' : 'Re-run with Overrides'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Results Dashboard ── */}
      {results && (
        <section className="content-card result-section">
          <h2>Reconciliation Results</h2>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {TABS.map((t) => (
              <button key={t.key} type="button"
                className={`secondary${activeTab === t.key ? ' active' : ''}`}
                style={activeTab === t.key ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : {}}
                onClick={() => setActiveTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* {activeTab === 'summary' && <SummaryPanel summary={results.summary} />} */}

          {activeTab === 'summary' && (
  <>
    <SummaryPanel summary={results.summary} />
  </>
)}


          {activeTab === 'matched' && <ResultsTable rows={results.matched_rows} />}
          {activeTab === 'mismatch' && <ResultsTable rows={results.mismatch_rows} />}
          {activeTab === 'only_src' && <ResultsTable rows={results.only_source_rows} />}
          {activeTab === 'only_tgt' && <ResultsTable rows={results.only_target_rows} />}
          {activeTab === 'tier2' && (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                These records matched after stripping a trailing suffix (e.g. <code>123456-1</code> → <code>123456</code>). Shown as a distinct category for audit.
              </p>
              <ResultsTable rows={results.tier2_rows} />
            </>
          )}
          {activeTab === 'duplicates' && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Source Duplicates</div>
              <ResultsTable rows={results.duplicate_source_rows} />
              <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>Target Duplicates</div>
              <ResultsTable rows={results.duplicate_target_rows} />
            </>
          )}
          {activeTab === 'exceptions' && (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Rows excluded from reconciliation due to blank IDs, non-numeric amounts, or unparseable dates.
              </p>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Source Exceptions</div>
              <ResultsTable rows={results.source_exceptions} />
              <div style={{ fontWeight: 600, margin: '16px 0 8px' }}>Target Exceptions</div>
              <ResultsTable rows={results.target_exceptions} />
            </>
          )}
          {activeTab === 'mapping' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <MappingTable title="Source File Mapping" mapping={mappingResult?.source_mapping} />
              <MappingTable title="Target File Mapping" mapping={mappingResult?.target_mapping} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
