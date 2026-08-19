import React, { useState, useMemo } from 'react';

const SourceTargetMappingSummary = ({ report, activeSeries, keyColumns }) => {
  // Extract key columns and schema mappings from the report data.
  //
  // IMPORTANT: by the time `report` reaches this component, the backend has
  // already aligned Target's column names onto Source's naming (either via
  // the user's manual Schema Mapping modal choices, applied first, or via
  // the automatic normalised-name heuristic for anything left unmapped —
  // see apply_manual_schema_mapping()/align_equivalent_columns() in
  // backend/app.py). That means a Source column and the Target column it
  // was actually compared against share the exact same name in
  // report.schema.source_columns / report.schema.target_columns. We read
  // straight from that backend-computed schema instead of guessing off a
  // sample row (the old approach broke whenever the first full_comparison
  // row happened to be an Added/Deleted row with an empty {} on one side —
  // {} is truthy in JS, so it looked like a valid "sample" and produced a
  // table of only Target-only columns).
  const { mappingRows, isRelationalDb, summaryCounts } = useMemo(() => {
    if (!report) return { mappingRows: [], isRelationalDb: false, summaryCounts: { total: 0, keys: 0, mapped: 0, skipped: 0 } };

    const keys = keyColumns || report.key_columns || [];
    const manualMap = report.schema_mapping || {};
    const sourceCols = report.schema?.source_columns || [];
    const targetCols = report.schema?.target_columns || [];
    const targetColSet = new Set(targetCols);

    // Check if the dataset originates from a database
    const isDb = Boolean(
      activeSeries?.series?.name?.toLowerCase().includes('target') ||
      activeSeries?.series?.name?.toLowerCase().includes('db') ||
      report.source_type === 'database' ||
      report.target_type === 'database'
    );

    const rows = [];
    const processedTarget = new Set();

    // Helper to detect key type
    const detectKeyType = (colName, isKeyCol, isDatabase) => {
      if (!colName || colName === '__ignore__') return 'None';
      if (isDatabase) {
        if (isKeyCol) return keys.length > 1 ? 'Composite Key' : 'Primary Key';
        const lower = colName.toLowerCase();
        if (lower.endsWith('_id') || lower.endsWith('id')) return 'Foreign Key';
        if (lower.includes('uuid') || lower.includes('code') || lower.includes('no')) return 'Unique Key';
        return 'Normal';
      } else {
        // Flat file (Excel / CSV)
        if (isKeyCol || colName.toLowerCase().includes('number') || colName.toLowerCase().includes('id') || colName.toLowerCase().includes('code')) {
          return 'Suggested Key';
        }
        return 'Normal';
      }
    };

    let mappedCount = 0;
    let skippedCount = 0;
    let keyCount = 0;

    sourceCols.forEach((sc) => {
      const isKey = keys.includes(sc);
      // A source column was explicitly skipped in the modal if it's mapped
      // to '__ignore__' there — otherwise, it's "mapped" iff a same-named
      // column now exists on the Target side (which is only true post
      // -alignment for columns that were actually matched).
      const wasExplicitlyIgnored = manualMap[sc] === '__ignore__' || manualMap[sc] === '-- Ignore / Skip --';
      const isMatched = !wasExplicitlyIgnored && targetColSet.has(sc);
      const targetCol = isMatched ? sc : '-- Ignored / Skipped --';
      const isIgnored = !isMatched;

      if (isMatched) processedTarget.add(sc);

      const srcType = detectKeyType(sc, isKey, isDb);
      const tgtType = isIgnored ? 'Ignored' : detectKeyType(targetCol, isKey, isDb);

      let status = 'Mapped';
      if (isKey) {
        status = 'Key Match';
        keyCount++;
      } else if (isIgnored) {
        status = 'Skipped';
        skippedCount++;
      } else {
        mappedCount++;
      }

      rows.push({
        id: `map-${sc}`,
        sourceCol: sc,
        sourceKeyType: srcType,
        targetCol: targetCol,
        targetKeyType: tgtType,
        isCompareKey: isKey,
        isIgnored: isIgnored,
        status: status,
      });
    });

    // Process remaining unmapped target-only columns
    targetCols.forEach((tc) => {
      if (processedTarget.has(tc) || keys.includes(tc)) return;
      const tgtType = detectKeyType(tc, false, isDb);
      rows.push({
        id: `map-tgt-${tc}`,
        sourceCol: '—',
        sourceKeyType: 'Normal',
        targetCol: tc,
        targetKeyType: tgtType,
        isCompareKey: false,
        isIgnored: false,
        status: 'Target Only',
      });
    });

    return {
      mappingRows: rows,
      isRelationalDb: isDb,
      summaryCounts: {
        total: sourceCols.length,
        keys: keyCount,
        mapped: mappedCount,
        skipped: skippedCount,
      },
    };
  }, [report, activeSeries, keyColumns]);

  // Checkbox selection state (for view/filtering only)
  const [selectedIds, setSelectedIds] = useState(() => {
    const set = new Set();
    mappingRows.forEach((r) => set.add(r.id));
    return set;
  });

  // Keep state in sync if report updates
  React.useEffect(() => {
    const set = new Set();
    mappingRows.forEach((r) => set.add(r.id));
    setSelectedIds(set);
  }, [mappingRows]);

  // Search & Filter state
  const [searchSource, setSearchSource] = useState('');
  const [searchTarget, setSearchTarget] = useState('');
  const [keyTypeFilter, setKeyTypeFilter] = useState('All');

  // Control handlers
  const handleSelectAll = () => {
    const set = new Set();
    mappingRows.forEach((r) => set.add(r.id));
    setSelectedIds(set);
  };

  const handleClearSelection = () => {
    const set = new Set();
    mappingRows.forEach((r) => {
      if (r.isCompareKey) set.add(r.id);
    });
    setSelectedIds(set);
  };

  const handleInvertSelection = () => {
    const set = new Set();
    mappingRows.forEach((r) => {
      if (r.isCompareKey) {
        set.add(r.id);
      } else if (!selectedIds.has(r.id)) {
        set.add(r.id);
      }
    });
    setSelectedIds(set);
  };

  const toggleSelect = (id, isCompareKey) => {
    if (isCompareKey) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    return mappingRows.filter((r) => {
      if (searchSource.trim() && !r.sourceCol.toLowerCase().includes(searchSource.toLowerCase().trim())) {
        return false;
      }
      if (searchTarget.trim() && !r.targetCol.toLowerCase().includes(searchTarget.toLowerCase().trim())) {
        return false;
      }
      if (keyTypeFilter !== 'All') {
        if (r.sourceKeyType !== keyTypeFilter && r.targetKeyType !== keyTypeFilter && r.status !== keyTypeFilter) {
          return false;
        }
      }
      return true;
    });
  }, [mappingRows, searchSource, searchTarget, keyTypeFilter]);

  // ── Pagination state ──────────────────────────────────────────────────
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [fetchPerf, setFetchPerf] = useState(null);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  // Reset to page 1 whenever the filtered set or page size changes, so we
  // never end up "stuck" on a page that no longer has any rows.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchSource, searchTarget, keyTypeFilter, pageSize, mappingRows.length]);

  React.useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pagedRows = useMemo(() => {
    const t0 = performance.now();
    const start = (currentPage - 1) * pageSize;
    const res = filteredRows.slice(start, start + pageSize);
    const elapsed = Math.round(performance.now() - t0);
    // Asynchronously log lightweight fetch time
    setTimeout(() => {
      setFetchPerf({ timeMs: Math.max(1, elapsed), count: res.length });
    }, 0);
    return res;
  }, [filteredRows, currentPage, pageSize]);

  // Badge renderer
  const renderBadge = (keyType) => {
    switch (keyType) {
      case 'Primary Key':
        return <span className="status-badge" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.3)' }}>🔑 Primary Key</span>;
      case 'Foreign Key':
        return <span className="status-badge" style={{ background: 'rgba(124, 58, 237, 0.15)', color: '#a78bfa', border: '1px solid rgba(124, 58, 237, 0.3)' }}>🔗 Foreign Key</span>;
      case 'Suggested Key':
        return <span className="status-badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}>⭐ Suggested Key</span>;
      case 'Unique Key':
        return <span className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)' }}>🔷 Unique Key</span>;
      case 'Composite Key':
        return <span className="status-badge" style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#38bdf8', border: '1px solid rgba(6, 182, 212, 0.4)' }}>🔑 Composite Key</span>;
      case 'Ignored':
        return <span className="status-badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)' }}>🚫 Ignored</span>;
      default:
        return <span className="status-badge status-neutral">⚪ Normal</span>;
    }
  };

  // Status renderer
  const renderStatus = (status) => {
    switch (status) {
      case 'Key Match':
        return <span className="status-badge" style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#38bdf8', border: '1px solid rgba(6, 182, 212, 0.4)', fontWeight: 700 }}>🔑 Key Match</span>;
      case 'Mapped':
        return <span className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>🟢 Mapped</span>;
      case 'Skipped':
        return <span className="status-badge" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.25)' }}>🚫 Skipped</span>;
      case 'Target Only':
        return <span className="status-badge" style={{ background: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1', border: '1px solid rgba(148, 163, 184, 0.3)' }}>🔹 Target Only</span>;
      default:
        return <span className="status-badge status-neutral">—</span>;
    }
  };

  return (
    <section className="content-card mapping-summary-card" style={{ marginTop: 20 }}>
      {/* ── Header & Action Bar ────────────────────────────────────────────── */}
      <div className="top-row" style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🧬</span> Source–Target Mapping Summary
          </h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
            Real schema mapping configured during reconciliation (showing key matches, mapped fields, and skipped columns)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={handleSelectAll}>
            Select All
          </button>
          <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={handleClearSelection}>
            Clear Selection
          </button>
          <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={handleInvertSelection}>
            Invert Selection
          </button>
        </div>
      </div>

      {/* ── Summary Counters Strip ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 14px', borderRadius: 8, border: '1px solid var(--card-border)', fontSize: '0.84rem' }}>
          <span className="muted">Total Source Columns:</span> <strong style={{ color: 'var(--text)' }}>{summaryCounts.total}</strong>
        </div>
        <div style={{ background: 'rgba(6, 182, 212, 0.1)', padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(6, 182, 212, 0.3)', fontSize: '0.84rem' }}>
          <span style={{ color: '#38bdf8' }}>🔑 Compare Keys:</span> <strong>{summaryCounts.keys}</strong>
        </div>
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.84rem' }}>
          <span style={{ color: '#34d399' }}>🟢 Active Mapped:</span> <strong>{summaryCounts.mapped}</strong>
        </div>
        <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.2)', fontSize: '0.84rem' }}>
          <span style={{ color: '#fca5a5' }}>🚫 Ignored / Skipped:</span> <strong>{summaryCounts.skipped}</strong>
        </div>
      </div>

      {/* ── Search & Filter Controls ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 10 }}>
        <input
          className="search-input"
          placeholder="Search Source Column..."
          value={searchSource}
          onChange={(e) => setSearchSource(e.target.value)}
          style={{ width: 180, fontSize: '0.85rem' }}
        />
        <input
          className="search-input"
          placeholder="Search Target Column..."
          value={searchTarget}
          onChange={(e) => setSearchTarget(e.target.value)}
          style={{ width: 180, fontSize: '0.85rem' }}
        />
        <select
          className="search-input"
          value={keyTypeFilter}
          onChange={(e) => setKeyTypeFilter(e.target.value)}
          style={{ width: 170, fontSize: '0.85rem' }}
        >
          <option value="All">Filter Key / Status: All</option>
          <option value="Key Match">🔑 Key Match</option>
          <option value="Mapped">🟢 Mapped</option>
          <option value="Skipped">🚫 Skipped</option>
          {isRelationalDb ? (
            <>
              <option value="Primary Key">Primary Key</option>
              <option value="Foreign Key">Foreign Key</option>
              <option value="Unique Key">Unique Key</option>
              <option value="Composite Key">Composite Key</option>
            </>
          ) : (
            <option value="Suggested Key">Suggested Key</option>
          )}
          <option value="Normal">Normal</option>
        </select>
        {(searchSource || searchTarget || keyTypeFilter !== 'All') && (
          <button
            type="button"
            className="secondary"
            style={{ padding: '4px 10px', fontSize: '0.82rem' }}
            onClick={() => { setSearchSource(''); setSearchTarget(''); setKeyTypeFilter('All'); }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* ── Table View ────────────────────────────────────────────────────── */}
      <div className="data-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="data-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--panel)' }}>
            <tr>
              <th style={{ width: 50, textAlign: 'center' }}>Select</th>
              <th>Source Column</th>
              <th>Source Key Type</th>
              <th>Target Column</th>
              <th>Target Key Type</th>
              <th style={{ width: 120, textAlign: 'center' }}>Status</th>
              <th style={{ width: 130, textAlign: 'center' }}>Compare Key</th>
            </tr>
          </thead>
          <tbody>
            {!filteredRows.length ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 18 }} className="muted">
                  No matching mapped columns found.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => {
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    style={{
                      background: row.isCompareKey
                        ? 'rgba(6, 182, 212, 0.06)'
                        : row.isIgnored
                        ? 'rgba(239, 68, 68, 0.03)'
                        : undefined,
                    }}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={row.isCompareKey}
                        onChange={() => toggleSelect(row.id, row.isCompareKey)}
                        style={{ cursor: row.isCompareKey ? 'not-allowed' : 'pointer' }}
                      />
                    </td>
                    <td style={{ fontWeight: row.isCompareKey ? 700 : 500 }}>
                      {row.sourceCol}
                    </td>
                    <td>{renderBadge(row.sourceKeyType)}</td>
                    <td style={{ fontWeight: row.isCompareKey ? 700 : 500 }}>
                      {row.isIgnored ? (
                        <span style={{ color: 'var(--muted)', fontStyle: 'italic', opacity: 0.75 }}>
                          🚫 -- Ignored / Skipped --
                        </span>
                      ) : (
                        row.targetCol
                      )}
                    </td>
                    <td>{renderBadge(row.targetKeyType)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {renderStatus(row.status)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {row.isCompareKey ? (
                        <span className="pill" style={{ background: 'rgba(6, 182, 212, 0.18)', color: 'var(--primary)', fontWeight: 700, borderColor: 'rgba(6, 182, 212, 0.4)' }}>
                          🔑 Selected
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.82rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination Bar ───────────────────────────────────────────────── */}
      {filteredRows.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--card-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }} className="muted">
            <span>Rows per page</span>
            <select
              className="search-input"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              style={{ width: 80, fontSize: '0.82rem', padding: '2px 6px' }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span>
              {filteredRows.length === 0
                ? '0 of 0'
                : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filteredRows.length)} of ${filteredRows.length}`}
            </span>
            {fetchPerf && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '2px 8px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 4, fontSize: '0.76rem', color: '#2563eb', fontWeight: 600, marginLeft: 8 }}>
                <span>⚡ Fetching Time: {fetchPerf.timeMs} ms</span>
                <span style={{ opacity: 0.4 }}>|</span>
                <span>📊 Records Fetched: {fetchPerf.count}</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '0.82rem' }}
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
            >
              « First
            </button>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '0.82rem' }}
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              ‹ Prev
            </button>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '0.82rem' }}
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next ›
            </button>
            <button
              type="button"
              className="secondary"
              style={{ padding: '4px 10px', fontSize: '0.82rem' }}
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              Last »
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default SourceTargetMappingSummary;
