import React, { useState, useMemo, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';

/**
 * TransactionScatterPlot Component
 *
 * Displays ONLY amount mismatches on the scatter plot with 100% flicker-free hover.
 * Tooltip shows:
 *   - Source Primary Key (Mapped Column & Value)
 *   - Target Primary Key (Mapped Column & Value)
 *   - Customer Name
 *   - Source Amount (₹)
 *   - Target Amount (₹)
 *   - Difference (₹)
 *   - Status: Mismatch
 */
export default function TransactionScatterPlot({ data = [], matchedData = [], mismatchData = [] }) {
  // ── Normalize input data prop ──────────────────────────────────────────
  const allRecords = useMemo(() => {
    if (data && data.length > 0) return data;

    const list = [];
    (matchedData || []).forEach((r, i) => {
      const src = typeof r.sourceAmount === 'number' ? r.sourceAmount : parseFloat(r.sourceAmount) || 0;
      const tgt = typeof r.targetAmount === 'number' ? r.targetAmount : parseFloat(r.targetAmount) || 0;
      const diff = Math.abs(r.diff ?? (src - tgt));
      list.push({
        id: `matched_${i}`,
        transactionNumber: r.sourceKeyValue || r.transactionNumber || r.transactionId || `TXN-${1000 + i}`,
        customerName: r.customerName || r.customer || 'N/A',
        sourceAmount: src,
        targetAmount: tgt,
        sourceKeyName: r.sourceKeyName || 'Primary Key',
        sourceKeyValue: r.sourceKeyValue || r.transactionNumber || 'N/A',
        targetKeyName: r.targetKeyName || 'Primary Key',
        targetKeyValue: r.targetKeyValue || r.transactionNumber || 'N/A',
        diff,
        status: diff <= 0.01 ? 'Matched' : 'Mismatch',
        sourceRow: r.sourceRow || r,
        targetRow: r.targetRow || r,
      });
    });

    (mismatchData || []).forEach((r, i) => {
      const src = typeof r.sourceAmount === 'number' ? r.sourceAmount : parseFloat(r.sourceAmount) || 0;
      const tgt = typeof r.targetAmount === 'number' ? r.targetAmount : parseFloat(r.targetAmount) || 0;
      const diff = Math.abs(r.diff ?? (src - tgt));
      list.push({
        id: `mismatch_${i}`,
        transactionNumber: r.sourceKeyValue || r.keyValue || r.transactionNumber || `TXN-M-${1000 + i}`,
        customerName: r.customerName || r.customer || 'N/A',
        sourceAmount: src,
        targetAmount: tgt,
        sourceKeyName: r.sourceKeyName || r.keyName || 'Primary Key',
        sourceKeyValue: r.sourceKeyValue || r.keyValue || 'N/A',
        targetKeyName: r.targetKeyName || r.keyName || 'Primary Key',
        targetKeyValue: r.targetKeyValue || r.keyValue || 'N/A',
        diff,
        status: 'Mismatch',
        sourceRow: r.sourceRow || r,
        targetRow: r.targetRow || r,
      });
    });

    return list;
  }, [data, matchedData, mismatchData]);

  // ── Filter State ───────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const [minDiff, setMinDiff] = useState('');
  const [maxDiff, setMaxDiff] = useState('');
  const [presetFilter, setPresetFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);

  // ── Currency Formatter (₹ Rupee) ───────────────────────────────────────
  const fmt = (v) => {
    if (v == null) return '₹0';
    const num = typeof v === 'number' ? v : parseFloat(v) || 0;
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  // ── Filtered Records (ONLY Mismatched Amount Records for Scatter Plot) ──
  const filteredMismatches = useMemo(() => {
    return allRecords.filter((item) => {
      // ONLY show amount mismatches (diff > 0.01)
      if (item.diff <= 0.01) return false;

      // Preset filters
      if (presetFilter === 'high' && item.diff < 10000) return false;
      if (presetFilter === 'low' && item.diff > 1000) return false;

      // Search term filter (Txn No, Key, or Customer)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchTxn = String(item.transactionNumber || '').toLowerCase().includes(q);
        const matchCust = String(item.customerName || '').toLowerCase().includes(q);
        const matchSrcKey = String(item.sourceKeyValue || '').toLowerCase().includes(q);
        const matchTgtKey = String(item.targetKeyValue || '').toLowerCase().includes(q);
        if (!matchTxn && !matchCust && !matchSrcKey && !matchTgtKey) return false;
      }

      // Min diff filter
      if (minDiff !== '' && !isNaN(parseFloat(minDiff))) {
        if (item.diff < parseFloat(minDiff)) return false;
      }

      // Max diff filter
      if (maxDiff !== '' && !isNaN(parseFloat(maxDiff))) {
        if (item.diff > parseFloat(maxDiff)) return false;
      }

      return true;
    });
  }, [allRecords, searchTerm, minDiff, maxDiff, presetFilter]);

  // ── Prepare Mismatch Series Data ───────────────────────────────────────
  const mismatchPoints = useMemo(() => {
    return filteredMismatches.map((r) => [
      r.sourceAmount,
      r.targetAmount,
      r.sourceKeyName || 'Primary Key',
      r.sourceKeyValue || 'N/A',
      r.targetKeyName || 'Primary Key',
      r.targetKeyValue || 'N/A',
      r.customerName || 'N/A',
      r.diff,
      'Mismatch',
      r.id,
    ]);
  }, [filteredMismatches]);

  // ── Tooltip Formatter strictly showing Source/Target Key Columns & Values ──
  const tooltipFormatter = (params) => {
    if (!params || !params.data) return '';
    const d = Array.isArray(params.data) ? params.data : params.data.value || [];
    const [src, tgt, srcKeyName, srcKeyValue, tgtKeyName, tgtKeyValue, cust, diff, status] = d;

    const isSameKeyName = srcKeyName === tgtKeyName;
    const srcKeyLabel = isSameKeyName ? `Source ${srcKeyName}` : `Source (${srcKeyName})`;
    const tgtKeyLabel = isSameKeyName ? `Target ${tgtKeyName}` : `Target (${tgtKeyName})`;

    return `
      <div style="font-family: inherit; font-size: 12.5px; line-height: 1.7; color: #f8fafc;">
        <div><b>${srcKeyLabel} :</b> ${srcKeyValue || 'N/A'}</div>
        <div><b>${tgtKeyLabel} :</b> ${tgtKeyValue || 'N/A'}</div>
        <div><b>Customer :</b> ${cust || 'N/A'}</div>
        <div><b>Source Amount :</b> ${fmt(src)}</div>
        <div><b>Target Amount :</b> ${fmt(tgt)}</div>
        <div><b>Difference :</b> ${fmt(diff)}</div>
        <div><b>Status :</b> <span style="color: #ef4444; font-weight: 700;">${status || 'Mismatch'}</span></div>
      </div>
    `;
  };

  // ── ECharts Configuration ─────────────────────────────────────────────
  const echartsOptions = useMemo(() => {
    const allAmts = filteredMismatches.flatMap((r) => [r.sourceAmount, r.targetAmount]).filter(Boolean);
    const maxVal = allAmts.length > 0 ? Math.max(...allAmts) * 1.1 : 100;

    return {
      backgroundColor: 'transparent',
      hoverLayerThreshold: 100000,
      tooltip: {
        show: true,
        trigger: 'item',
        showDelay: 0,
        hideDelay: 0,
        transitionDuration: 0,
        enterable: false,
        confine: true,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(239, 68, 68, 0.4)',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#e2e8f0', fontSize: 12.5 },
        extraCssText: 'border-radius:10px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(12px); pointer-events: none; user-select: none; z-index: 99999;',
        position: function (point) {
          return [point[0] + 15, point[1] - 15];
        },
        formatter: tooltipFormatter,
      },
      legend: {
        data: ['Amount Mismatch'],
        top: 10,
        right: 120,
        textStyle: { color: 'var(--muted, #94a3b8)', fontSize: 12, fontWeight: 600 },
        itemWidth: 12,
        itemHeight: 12,
        borderRadius: 2,
      },
      grid: { left: 80, right: 40, top: 50, bottom: 85 },
      xAxis: {
        name: 'Source Invoice Amount (₹)',
        nameLocation: 'center',
        nameGap: 38,
        nameTextStyle: { color: 'var(--muted, #94a3b8)', fontSize: 12.5, fontWeight: 600 },
        type: 'value',
        scale: true,
        min: 0,
        axisLabel: {
          color: 'var(--muted, #94a3b8)',
          fontSize: 11,
          formatter: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`),
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.10)' } },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.25)' } },
      },
      yAxis: {
        name: 'Target Entered Amount (₹)',
        nameLocation: 'center',
        nameGap: 56,
        nameTextStyle: { color: 'var(--muted, #94a3b8)', fontSize: 12.5, fontWeight: 600 },
        type: 'value',
        scale: true,
        min: 0,
        axisLabel: {
          color: 'var(--muted, #94a3b8)',
          fontSize: 11,
          formatter: (v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`),
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.10)' } },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.25)' } },
      },
      series: [
        {
          name: 'Amount Mismatch',
          type: 'scatter',
          data: mismatchPoints,
          symbolSize: 10,
          symbol: 'circle',
          hoverAnimation: false,
          itemStyle: {
            color: '#ef4444',
            opacity: 0.9,
          },
          emphasis: {
            focus: 'none',
            scale: false,
            itemStyle: {
              color: '#ef4444',
              shadowBlur: 8,
              shadowColor: 'rgba(239, 68, 68, 0.8)',
              borderColor: '#ffffff',
              borderWidth: 2,
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: 'rgba(148,163,184,0.35)', width: 1.5 },
            label: { show: true, position: 'end', formatter: 'y = x', color: 'var(--muted, #94a3b8)', fontSize: 10 },
            data: [[{ coord: [0, 0] }, { coord: [maxVal, maxVal] }]],
          },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, yAxisIndex: 0 },
        { type: 'slider', xAxisIndex: 0, bottom: 12, height: 18, borderColor: 'rgba(148,163,184,0.15)', fillerColor: 'rgba(239,68,68,0.15)' },
      ],
      toolbox: {
        right: 16,
        top: 6,
        feature: {
          saveAsImage: { title: 'Save as PNG', iconStyle: { borderColor: 'var(--muted, #94a3b8)' } },
          dataView: { readOnly: true, title: 'Data View', iconStyle: { borderColor: 'var(--muted, #94a3b8)' } },
          restore: { title: 'Reset Zoom', iconStyle: { borderColor: 'var(--muted, #94a3b8)' } },
        },
      },
    };
  }, [filteredMismatches, mismatchPoints]);

  // ── Click Event Handler for Scatter Points ─────────────────────────────
  const onChartClick = useCallback((params) => {
    if (params && params.data) {
      const pointId = params.data[9];
      const rec = allRecords.find((r) => r.id === pointId);
      if (rec) {
        setSelectedRecord(rec);
      }
    }
  }, [allRecords]);

  const chartEvents = useMemo(() => ({ click: onChartClick }), [onChartClick]);

  // ── Export Filtered Mismatches to CSV ──────────────────────────────────
  const exportToCSV = () => {
    if (!filteredMismatches.length) return;
    const headers = ['Source Key Column', 'Source Key Value', 'Target Key Column', 'Target Key Value', 'Customer', 'Source Amount (INR)', 'Target Amount (INR)', 'Difference (INR)', 'Status'];
    const rows = filteredMismatches.map((r) => [
      `"${r.sourceKeyName || ''}"`,
      `"${r.sourceKeyValue || ''}"`,
      `"${r.targetKeyName || ''}"`,
      `"${r.targetKeyValue || ''}"`,
      `"${r.customerName || ''}"`,
      r.sourceAmount,
      r.targetAmount,
      r.diff,
      `"${r.status}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation_mismatches_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Helper to extract additional fields for Side Panel ──────────────────
  const getField = (obj, keys) => {
    if (!obj) return 'N/A';
    for (const k of keys) {
      if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]);
    }
    return 'N/A';
  };

  return (
    <div className="transaction-scatter-explorer" style={{ marginTop: 24 }}>
      {/* ── Filters & Search Toolbar ─────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '14px 16px', background: 'var(--panel, #071830)', borderRadius: 10, border: '1px solid rgba(148,163,184,0.15)', marginBottom: 16 }}>
        {/* Search Input */}
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <input
            className="search-input"
            type="text"
            placeholder="🔍 Search Key Value or Customer…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', fontSize: '0.84rem' }}
          />
        </div>

        {/* Difference Range Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Diff Range:</span>
          <input
            className="search-input"
            type="number"
            placeholder="Min ₹"
            value={minDiff}
            onChange={(e) => setMinDiff(e.target.value)}
            style={{ width: 85, fontSize: '0.82rem' }}
          />
          <span style={{ color: 'var(--muted)' }}>–</span>
          <input
            className="search-input"
            type="number"
            placeholder="Max ₹"
            value={maxDiff}
            onChange={(e) => setMaxDiff(e.target.value)}
            style={{ width: 85, fontSize: '0.82rem' }}
          />
        </div>

        {/* Export Button */}
        <button type="button" className="secondary" onClick={exportToCSV} disabled={!filteredMismatches.length} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          📥 Export CSV ({filteredMismatches.length})
        </button>

        {/* Reset Filters Button */}
        {(searchTerm || minDiff || maxDiff || presetFilter !== 'all') && (
          <button
            type="button"
            className="secondary"
            onClick={() => { setSearchTerm(''); setMinDiff(''); setMaxDiff(''); setPresetFilter('all'); }}
            style={{ fontSize: '0.78rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
          >
            ✕ Reset Filters
          </button>
        )}
      </div>

      {/* ── Scatter Plot Chart ────────────────────────────────────────── */}
      {filteredMismatches.length > 0 ? (
        <div style={{ position: 'relative', background: 'var(--panel, #071830)', borderRadius: 12, padding: 12, border: '1px solid rgba(148,163,184,0.12)' }}>
          <ReactECharts
            option={echartsOptions}
            onEvents={chartEvents}
            style={{ height: '460px', width: '100%' }}
            notMerge={false}
            lazyUpdate={true}
          />
        </div>
      ) : (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e', fontSize: '0.92rem', fontWeight: 600, background: 'rgba(34,197,94,0.06)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
          ✓ No invoice amount mismatches found matching the selected criteria.
        </div>
      )}

      {/* ── Click Action Detail Modal / Side Panel ────────────────────── */}
      {selectedRecord && (
        <div
          className="eda-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedRecord(null); }}
          style={{ zIndex: 100000 }}
        >
          <div className="eda-modal" style={{ maxWidth: 640, width: '92%' }}>
            {/* Modal Header */}
            <div className="eda-modal-head" style={{ borderBottom: '1px solid rgba(148,163,184,0.15)', paddingBottom: 14 }}>
              <div>
                <div className="eda-eyebrow">Reconciliation Detail Explorer</div>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.25rem' }}>
                  {selectedRecord.sourceKeyName}: {selectedRecord.sourceKeyValue}
                </h2>
              </div>
              <button type="button" className="secondary" onClick={() => setSelectedRecord(null)}>✕ Close</button>
            </div>

            {/* Modal Body */}
            <div style={{ marginTop: 16 }}>
              {/* Status Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justify: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 8,
                  marginBottom: 16,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Reconciliation Status: </span>
                  <strong style={{ color: '#ef4444', fontSize: '1rem' }}>
                    Mismatch
                  </strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Calculated Difference: </span>
                  <strong style={{ color: '#ef4444', fontSize: '1.05rem' }}>
                    {fmt(selectedRecord.diff)}
                  </strong>
                </div>
              </div>

              {/* Source vs Target Comparison Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Source Data Card */}
                <div className="card" style={{ borderTop: '3px solid var(--primary)', padding: 14 }}>
                  <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: 'var(--primary)' }}>Source Dataset</h3>
                  <div style={{ display: 'grid', gap: 8, fontSize: '0.84rem' }}>
                    <div>
                      <span className="muted">{selectedRecord.sourceKeyName}: </span>
                      <strong>{selectedRecord.sourceKeyValue}</strong>
                    </div>
                    <div>
                      <span className="muted">Invoice Amount: </span>
                      <strong style={{ color: 'var(--text)' }}>{fmt(selectedRecord.sourceAmount)}</strong>
                    </div>
                    <div>
                      <span className="muted">Customer: </span>
                      <strong>{getField(selectedRecord.sourceRow, ['Customer', 'CustomerName', 'Full_Name', 'Name', 'Client']) || selectedRecord.customerName}</strong>
                    </div>
                    <div>
                      <span className="muted">PO Number: </span>
                      <strong>{getField(selectedRecord.sourceRow, ['PO Number', 'Po Number', 'PO_Number', 'Po_Number', 'PONumber', 'po_number'])}</strong>
                    </div>
                    <div>
                      <span className="muted">Txn Date: </span>
                      <strong>{getField(selectedRecord.sourceRow, ['TxnDate', 'Date', 'Transaction_Date', 'Invoice_Date', 'date'])}</strong>
                    </div>
                  </div>
                </div>

                {/* Target Data Card */}
                <div className="card" style={{ borderTop: '3px solid var(--accent)', padding: 14 }}>
                  <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: 'var(--accent)' }}>Target Dataset</h3>
                  <div style={{ display: 'grid', gap: 8, fontSize: '0.84rem' }}>
                    <div>
                      <span className="muted">{selectedRecord.targetKeyName}: </span>
                      <strong>{selectedRecord.targetKeyValue}</strong>
                    </div>
                    <div>
                      <span className="muted">Entered Amount: </span>
                      <strong style={{ color: 'var(--text)' }}>{fmt(selectedRecord.targetAmount)}</strong>
                    </div>
                    <div>
                      <span className="muted">Customer: </span>
                      <strong>{getField(selectedRecord.targetRow, ['Customer', 'CustomerName', 'Full_Name', 'Name', 'Client']) || selectedRecord.customerName}</strong>
                    </div>
                    <div>
                      <span className="muted">PO Number: </span>
                      <strong>{getField(selectedRecord.targetRow, ['PO Number', 'Po Number', 'PO_Number', 'Po_Number', 'PONumber', 'po_number'])}</strong>
                    </div>
                    <div>
                      <span className="muted">Txn Date: </span>
                      <strong>{getField(selectedRecord.targetRow, ['TxnDate', 'Date', 'Transaction_Date', 'Invoice_Date', 'date'])}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button type="button" className="dash-btn-primary" onClick={() => setSelectedRecord(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
