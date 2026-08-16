import React, { useState, useEffect } from 'react';

const SchemaMappingModal = ({
  isOpen,
  onClose,
  sourceFileName,
  targetFileName,
  sourceColumns = [],
  targetColumns = [],
  onConfirmReconcile,
  isReconciling = false,
  uploadFile = null,
}) => {
  const [sourceKey, setSourceKey] = useState('');
  const [targetKey, setTargetKey] = useState('');
  const [columnMap, setColumnMap] = useState({}); // { [sourceCol]: targetCol }
  const [amountSourceCol, setAmountSourceCol] = useState('');
  const [amountTargetCol, setAmountTargetCol] = useState('');
  const [sumPreview, setSumPreview] = useState(null); // { sumSource, sumTarget, difference }
  const [sumLoading, setSumLoading] = useState(false);

  // Initialize key selections and column mapping dropdowns
  useEffect(() => {
    if (!isOpen) return;

    // Default source key column selection
    let defaultSrcKey = sourceKey;
    if (!defaultSrcKey || !sourceColumns.includes(defaultSrcKey)) {
      defaultSrcKey = sourceColumns.find((col) => {
        const lower = col.toLowerCase();
        return lower.includes('number') || lower.includes('id') || lower.includes('key') || lower.includes('code');
      }) || sourceColumns[0] || '';
      if (defaultSrcKey) setSourceKey(defaultSrcKey);
    }

    // Default target key column selection
    let defaultTgtKey = targetKey;
    if (targetColumns.length > 0 && (!defaultTgtKey || !targetColumns.includes(defaultTgtKey))) {
      defaultTgtKey = targetColumns.find((col) => {
        const lower = col.toLowerCase();
        return lower.includes('number') || lower.includes('id') || lower.includes('key') || lower.includes('code');
      }) || targetColumns[0] || '';
      if (defaultTgtKey) setTargetKey(defaultTgtKey);
    }

    // Auto-detect default source amount column
    let defaultSrcAmt = amountSourceCol;
    if (!defaultSrcAmt || !sourceColumns.includes(defaultSrcAmt)) {
      defaultSrcAmt = sourceColumns.find((col) => {
        const lower = col.toLowerCase();
        return lower.includes('amount') || lower.includes('amt') || lower.includes('total') || lower.includes('price') || lower.includes('val') || lower.includes('balance') || lower.includes('cost');
      }) || '';
      setAmountSourceCol(defaultSrcAmt);
    }

    // Auto-detect default target amount column
    let defaultTgtAmt = amountTargetCol;
    if (targetColumns.length > 0 && (!defaultTgtAmt || !targetColumns.includes(defaultTgtAmt))) {
      defaultTgtAmt = targetColumns.find((col) => {
        const lower = col.toLowerCase();
        return lower.includes('amount') || lower.includes('amt') || lower.includes('total') || lower.includes('price') || lower.includes('val') || lower.includes('balance') || lower.includes('cost');
      }) || '';
      setAmountTargetCol(defaultTgtAmt);
    }

    // Auto-map source columns to actual target columns
    const initialMap = {};
    sourceColumns.forEach((sc) => {
      // 1. Exact match
      if (targetColumns.includes(sc)) {
        initialMap[sc] = sc;
        return;
      }
      // 2. Normalized / fuzzy match (e.g. PartyNumber -> PARTY_NUMBER)
      const sClean = sc.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = targetColumns.find((tc) => {
        const tClean = tc.toLowerCase().replace(/[^a-z0-9]/g, '');
        return tClean === sClean || sClean.includes(tClean) || tClean.includes(sClean);
      });
      if (match) {
        initialMap[sc] = match;
      } else if (sc === defaultSrcKey && defaultTgtKey) {
        // If this is the key row, default to target key
        initialMap[sc] = defaultTgtKey;
      } else {
        initialMap[sc] = '__ignore__';
      }
    });
    setColumnMap(initialMap);
  }, [isOpen, sourceColumns, targetColumns]);

  // Compute live sum preview when amount columns or file change
  useEffect(() => {
    if (!isOpen || !uploadFile || (!amountSourceCol && !amountTargetCol)) {
      setSumPreview(null);
      return;
    }
    let cancelled = false;
    setSumLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (cancelled) return;
      try {
        const text = e.target.result || '';
        const lines = text.split(/\r\n|\n/).filter(Boolean);
        if (lines.length < 2) { setSumPreview(null); setSumLoading(false); return; }
        const headers = lines[0].split(/,|\t/).map((h) => h.replace(/^"|"$/g, '').trim());
        const rows = lines.slice(1).map((line) => {
          const vals = line.split(/,|\t/).map((v) => v.replace(/^"|"$/g, '').trim());
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
        const toNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
        const sumSource = amountSourceCol ? rows.reduce((acc, r) => acc + toNum(r[amountSourceCol]), 0) : null;
        const sumTarget = amountTargetCol ? rows.reduce((acc, r) => acc + toNum(r[amountTargetCol]), 0) : null;
        const difference = sumSource !== null && sumTarget !== null ? sumSource - sumTarget : null;
        if (!cancelled) setSumPreview({ sumSource, sumTarget, difference });
      } catch {
        if (!cancelled) setSumPreview(null);
      }
      if (!cancelled) setSumLoading(false);
    };
    reader.onerror = () => { if (!cancelled) { setSumPreview(null); setSumLoading(false); } };
    reader.readAsText(uploadFile);
    return () => { cancelled = true; };
  }, [isOpen, uploadFile, amountSourceCol, amountTargetCol]);

  // Keep targetKey and columnMap in sync if sourceKey changes
  const handleSourceKeyChange = (newSrcKey) => {
    setSourceKey(newSrcKey);
    let tgt = columnMap[newSrcKey];
    if (!tgt || tgt === '__ignore__') {
      const sClean = newSrcKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      tgt = targetColumns.find((tc) => tc.toLowerCase().replace(/[^a-z0-9]/g, '') === sClean) || targetKey || targetColumns[0];
    }
    if (tgt && targetColumns.includes(tgt)) {
      setTargetKey(tgt);
      setColumnMap((prev) => ({ ...prev, [newSrcKey]: tgt }));
    }
  };

  // Keep sourceKey and columnMap in sync if targetKey changes
  const handleTargetKeyChange = (newTgtKey) => {
    setTargetKey(newTgtKey);
    if (sourceKey) {
      setColumnMap((prev) => ({ ...prev, [sourceKey]: newTgtKey }));
    }
  };

  // Handler for mapping dropdown per row
  const handleMappingChange = (sourceCol, newTargetCol) => {
    setColumnMap((prev) => ({
      ...prev,
      [sourceCol]: newTargetCol,
    }));
    // If changing the source key's target column, sync targetKey
    if (sourceCol === sourceKey && newTargetCol !== '__ignore__') {
      setTargetKey(newTargetCol);
    }
  };

  // AI Auto-Map button
  const handleAiAutoMap = () => {
    const nextMap = {};
    sourceColumns.forEach((sc) => {
      const sLower = sc.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exactMatch = targetColumns.find((tc) => tc === sc);
      if (exactMatch) {
        nextMap[sc] = exactMatch;
        return;
      }
      const fuzzyMatch = targetColumns.find((tc) => {
        const tLower = tc.toLowerCase().replace(/[^a-z0-9]/g, '');
        return sLower.includes(tLower) || tLower.includes(sLower);
      });
      if (fuzzyMatch) {
        nextMap[sc] = fuzzyMatch;
      } else if (sc === sourceKey && targetKey) {
        nextMap[sc] = targetKey;
      } else {
        nextMap[sc] = '__ignore__';
      }
    });
    setColumnMap(nextMap);
  };

  // Reset / Skip Mapping button
  const handleSkipMapping = () => {
    const nextMap = {};
    sourceColumns.forEach((sc) => {
      const exactOrCaseMatch = targetColumns.find((tc) => tc.toLowerCase() === sc.toLowerCase());
      nextMap[sc] = exactOrCaseMatch || '__ignore__';
    });
    if (sourceKey && targetKey) {
      nextMap[sourceKey] = targetKey;
    }
    setColumnMap(nextMap);
  };

  if (!isOpen) return null;

  const handleReconcileClick = () => {
    if (!sourceKey) {
      alert('Please select a Source Key Column.');
      return;
    }
    onConfirmReconcile(sourceKey, targetKey || sourceKey, columnMap, amountSourceCol, amountTargetCol);
  };

  return (
    <div
      className="eda-modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        className="content-card"
        style={{
          width: '100%',
          maxWidth: 860,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: '1px solid var(--card-border)',
          borderRadius: 18,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
          padding: 24,
          overflow: 'hidden',
        }}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, borderBottom: '1px solid var(--card-border)', paddingBottom: 14, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.45rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.6rem' }}>🧬</span> Schema Mapping
            </h2>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.88rem' }}>
              Map differing source and target column headers for reconciliation.
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={isReconciling}
            style={{ padding: '6px 14px', fontSize: '0.88rem', borderRadius: 8, cursor: 'pointer' }}
          >
            ✕ Cancel
          </button>
        </div>

        {/* ── Source & Target Key & Amount Selectors Bar ──────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16, background: 'rgba(0,0,0,0.22)', padding: 14, borderRadius: 12, border: '1px solid var(--card-border)', flexShrink: 0 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: 6, color: 'var(--text)' }}>
              🔑 Source Key Column (Source File) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="search-input"
              value={sourceKey}
              onChange={(e) => handleSourceKeyChange(e.target.value)}
              style={{ width: '100%', fontSize: '0.9rem', padding: '8px 12px' }}
            >
              {!sourceColumns.length && <option value="">Loading columns…</option>}
              {sourceColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: 6, color: 'var(--text)' }}>
              🔑 Target Key Column (Target File) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="search-input"
              value={targetKey}
              onChange={(e) => handleTargetKeyChange(e.target.value)}
              style={{ width: '100%', fontSize: '0.9rem', padding: '8px 12px' }}
            >
              {!targetColumns.length && <option value="">Loading columns…</option>}
              {targetColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: 6, color: 'var(--primary)' }}>
              💵 Source Amount Column (Transaction Calc)
            </label>
            <select
              className="search-input"
              value={amountSourceCol}
              onChange={(e) => setAmountSourceCol(e.target.value)}
              style={{ width: '100%', fontSize: '0.9rem', padding: '8px 12px' }}
            >
              <option value="">— Select amount column —</option>
              {sourceColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: 6, color: 'var(--accent)' }}>
              💵 Target Amount Column (Transaction Calc)
            </label>
            <select
              className="search-input"
              value={amountTargetCol}
              onChange={(e) => setAmountTargetCol(e.target.value)}
              style={{ width: '100%', fontSize: '0.9rem', padding: '8px 12px' }}
            >
              <option value="">— Select amount column —</option>
              {targetColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
          </div>

        {/* ── Live Sum Preview (from selected amount columns) ──────────────── */}
        {(amountSourceCol || amountTargetCol) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16, background: 'rgba(0,0,0,0.22)', padding: 12, borderRadius: 12, border: '1px solid var(--card-border)', flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
                Sum Source {amountSourceCol ? `(${amountSourceCol})` : ''}
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                {sumLoading ? '…' : (sumPreview?.sumSource != null
                  ? Number(sumPreview.sumSource).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—')}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
                Sum Target {amountTargetCol ? `(${amountTargetCol})` : ''}
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                {sumLoading ? '…' : (sumPreview?.sumTarget != null
                  ? Number(sumPreview.sumTarget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—')}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: (sumPreview?.difference ?? 0) === 0 ? '#22c55e' : '#ef4444', marginBottom: 4 }}>
                Difference (Source − Target)
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: (sumPreview?.difference ?? 0) === 0 ? '#22c55e' : '#ef4444' }}>
                {sumLoading ? '…' : (sumPreview?.difference != null
                  ? Number(sumPreview.difference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—')}
              </div>
            </div>
          </div>
        )}

        {/* ── Source vs Target Mapping Table ────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 180, overflowY: 'auto', marginBottom: 16, border: '1px solid var(--card-border)', borderRadius: 10 }}>
          <table className="data-table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--panel)' }}>
              <tr>
                <th style={{ width: '45%' }}>Source Column (Source File)</th>
                <th style={{ width: '55%' }}>Target Column (Target File)</th>
              </tr>
            </thead>
            <tbody>
              {!sourceColumns.length ? (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: 20 }} className="muted">
                    Parsing column headers from files…
                  </td>
                </tr>
              ) : (
                sourceColumns.map((srcCol) => {
                  const currentTgt = columnMap[srcCol] || '__ignore__';
                  const isMatched = currentTgt !== '__ignore__' && targetColumns.includes(currentTgt);
                  const isKeyRow = srcCol === sourceKey;
                  return (
                    <tr key={srcCol} style={{ background: isKeyRow ? 'rgba(6, 182, 212, 0.06)' : undefined }}>
                      <td style={{ fontWeight: 600, fontSize: '0.92rem', padding: '10px 14px' }}>
                        {srcCol}
                        {isKeyRow && <span className="pill" style={{ marginLeft: 8, fontSize: '0.72rem', background: 'rgba(6,182,212,0.2)', color: 'var(--primary)' }}>🔑 Key</span>}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select
                            className="search-input"
                            value={currentTgt}
                            onChange={(e) => handleMappingChange(srcCol, e.target.value)}
                            style={{ flex: 1, fontSize: '0.9rem', padding: '6px 10px' }}
                          >
                            <option value="__ignore__">-- Ignore / Skip --</option>
                            {targetColumns.map((tc) => (
                              <option key={tc} value={tc}>
                                {tc}
                              </option>
                            ))}
                          </select>
                          {isMatched && (
                            <span title="Matched target column" style={{ fontSize: '1.1rem', cursor: 'help' }}>
                              ⭐
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Action Buttons Footer (Sticky & Always Visible) ──────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--card-border)', paddingTop: 16, flexShrink: 0, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={handleAiAutoMap}
              style={{ padding: '8px 14px', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            >
              🤖 AI Auto-Map
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleSkipMapping}
              style={{ padding: '8px 14px', fontSize: '0.86rem', cursor: 'pointer' }}
            >
              Reset Mapping
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="secondary"
              onClick={handleReconcileClick}
              disabled={isReconciling || !sourceKey}
              style={{ padding: '8px 18px', fontSize: '0.88rem', cursor: 'pointer' }}
            >
              Accept & Reconcile
            </button>
            <button
              type="button"
              className="run-btn"
              onClick={handleReconcileClick}
              disabled={isReconciling || !sourceKey}
              style={{ padding: '8px 22px', fontSize: '0.92rem', background: 'linear-gradient(135deg, #10b981, #059669)', cursor: 'pointer' }}
            >
              {isReconciling ? 'Reconciling…' : '💾 Save & Reconcile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SchemaMappingModal;
