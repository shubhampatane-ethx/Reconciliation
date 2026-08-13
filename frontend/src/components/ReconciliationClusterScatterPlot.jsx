import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

/**
 * Helper to produce a clean, short filename for tooltips
 */
const getShortFileName = (str) => {
  if (!str) return 'Dataset';
  // Remove file extensions (.xlsx, .csv, etc.)
  let cleaned = str.replace(/\.[^/.]+$/, '');
  // Shorten if longer than 15 characters
  if (cleaned.length > 15) {
    return cleaned.substring(0, 13) + '…';
  }
  return cleaned;
};

/**
 * ReconciliationClusterScatterPlot Component
 * Clean white-background enterprise scatter plot showing 3 color-coded series
 * (Updated 🟡, Inserted 🔵, Missing 🔴) with Recon_id search filtering,
 * count-wise Recon_id filter (Last 10 | 20 | 50 | Custom | All), zoom controls,
 * and small square-shaped tooltips displaying short filenames.
 */
export default function ReconciliationClusterScatterPlot({ runs = [] }) {
  // Search query state for filtering reconciliation runs strictly by Recon_id
  const [searchQuery, setSearchQuery] = useState('');

  // Count-wise Recon_id filter state: 'all' | '10' | '20' | '50' | 'custom'
  const [countFilter, setCountFilter] = useState('all');
  const [customCount, setCustomCount] = useState(15);

  // Use real runs directly
  const rawChartData = useMemo(() => {
    return Array.isArray(runs) ? runs : [];
  }, [runs]);

  // Filter runs by count limit (Last 10 | Last 20 | Last 50 | Custom | All)
  const countFilteredData = useMemo(() => {
    if (!rawChartData.length) return [];
    if (countFilter === '10') return rawChartData.slice(-10);
    if (countFilter === '20') return rawChartData.slice(-20);
    if (countFilter === '50') return rawChartData.slice(-50);
    if (countFilter === 'custom') {
      const num = Math.max(1, parseInt(customCount, 10) || 10);
      return rawChartData.slice(-num);
    }
    return rawChartData;
  }, [rawChartData, countFilter, customCount]);

  // Filter runs strictly by Recon_id search input
  const chartData = useMemo(() => {
    if (!searchQuery.trim()) return countFilteredData;
    const q = searchQuery.toLowerCase().trim().replace(/^run\s*/i, 'r');
    return countFilteredData.filter((d, i) => {
      const runId = (d.name || `R${i + 1}`).toLowerCase();
      const numStr = String(i + 1);
      return (
        runId === q ||
        runId.includes(q) ||
        numStr === q ||
        `r${numStr}`.includes(q)
      );
    });
  }, [countFilteredData, searchQuery]);

  // Dynamic counter description for future-proof total count display
  const statusLabel = useMemo(() => {
    const total = rawChartData.length;
    const plotted = chartData.length;

    if (searchQuery.trim()) {
      return `Showing ${plotted} of ${total} total Recon_id runs matching search`;
    }
    if (countFilter === 'all') {
      return `Showing all ${total} total Recon_id runs`;
    }
    return `Showing last ${plotted} of ${total} total Recon_id runs`;
  }, [rawChartData.length, chartData.length, countFilter, searchQuery]);

  // Aggregate KPI summary stats & find max value for dynamic scaling
  const { totals, maxVal } = useMemo(() => {
    let updatedSum = 0;
    let insertedSum = 0;
    let missingSum = 0;
    let maxV = 10;

    chartData.forEach((d) => {
      const u = d.updated || 0;
      const i = d.inserted || 0;
      const m = d.missing || 0;
      updatedSum += u;
      insertedSum += i;
      missingSum += m;
      maxV = Math.max(maxV, u, i, m);
    });

    return {
      totals: {
        updated: updatedSum,
        inserted: insertedSum,
        missing: missingSum,
        totalRuns: chartData.length,
      },
      maxVal: maxV,
    };
  }, [chartData]);

  // Calculate y-axis negative offset so the 0 line is positioned high above the bottom axis
  const yMin = useMemo(() => {
    return -Math.max(3, Math.ceil(maxVal * 0.08));
  }, [maxVal]);

  // Construct series data with horizontal offsets for visual clustering
  // Hide 0-count points (symbolSize = 0) to avoid dense bottom overlapping line
  const { categories, updatedSeries, insertedSeries, missingSeries } = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { categories: [], updatedSeries: [], insertedSeries: [], missingSeries: [] };
    }

    const cats = chartData.map((d, i) => d.name || `R${i + 1}`);

    // Offsets: Updated (-0.16), Inserted (0), Missing (+0.16)
    const updated = chartData.map((d, i) => {
      const count = d.updated ?? 0;
      const rawLabel = d.sourceFile || d.label || d.name || `Recon ${i + 1}`;
      return {
        value: [i - 0.16, count],
        name: d.name || `R${i + 1}`,
        reconLabel: rawLabel,
        shortFile: getShortFileName(rawLabel),
        count,
        runIndex: i + 1,
        symbolSize: count > 0 ? 12 : 0, // Only show solid dots for non-zero counts
      };
    });

    const inserted = chartData.map((d, i) => {
      const count = d.inserted ?? 0;
      const rawLabel = d.sourceFile || d.label || d.name || `Recon ${i + 1}`;
      return {
        value: [i, count],
        name: d.name || `R${i + 1}`,
        reconLabel: rawLabel,
        shortFile: getShortFileName(rawLabel),
        count,
        runIndex: i + 1,
        symbolSize: count > 0 ? 12 : 0,
      };
    });

    const missing = chartData.map((d, i) => {
      const count = d.missing ?? 0;
      const rawLabel = d.sourceFile || d.label || d.name || `Recon ${i + 1}`;
      return {
        value: [i + 0.16, count],
        name: d.name || `R${i + 1}`,
        reconLabel: rawLabel,
        shortFile: getShortFileName(rawLabel),
        count,
        runIndex: i + 1,
        symbolSize: count > 0 ? 12 : 0,
      };
    });

    return {
      categories: cats,
      updatedSeries: updated,
      insertedSeries: inserted,
      missingSeries: missing,
    };
  }, [chartData]);

  // High-performance ECharts option configuration
  const getOption = () => ({
    backgroundColor: '#ffffff',
    animationDuration: 800,
    animationEasing: 'cubicOut',
    toolbox: {
      show: true,
      right: 20,
      top: 0,
      itemSize: 14,
      itemGap: 10,
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          title: { zoom: 'Box Zoom', back: 'Reset Zoom' },
        },
        restore: { title: 'Reset View' },
        saveAsImage: { title: 'Export Image' },
      },
      iconStyle: {
        borderColor: '#475569',
      },
      emphasis: {
        iconStyle: {
          borderColor: '#2563eb',
        },
      },
    },
    dataZoom: [
      {
        type: 'inside', // Mouse scroll wheel zooming & pan
        xAxisIndex: 0,
        filterMode: 'filter',
      },
      {
        type: 'slider', // Zoom slider bar under chart
        xAxisIndex: 0,
        bottom: 10,
        height: 20,
        borderColor: '#cbd5e1',
        fillerColor: 'rgba(59, 130, 246, 0.15)',
        handleStyle: {
          color: '#2563eb',
          borderColor: '#1d4ed8',
        },
        textStyle: {
          color: '#64748b',
          fontSize: 11,
        },
        brushSelect: false,
      },
    ],
    // Small square-shaped tooltip styling displaying short filename
    tooltip: {
      trigger: 'item',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      borderWidth: 1,
      padding: [8, 10],
      borderRadius: 3, // Crisp square shape!
      extraCssText: 'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35); min-width: 125px; box-sizing: border-box; text-align: center; pointer-events: none;',
      textStyle: {
        color: '#f8fafc',
        fontSize: 11,
      },
      formatter: (params) => {
        const point = params.data;
        const color = params.color;
        const seriesName = params.seriesName;
        return `
          <div style="font-weight: 700; font-size: 11px; color: #38bdf8; margin-bottom: 2px; letter-spacing: 0.04em;">
            ${point.name || `Recon_${point.runIndex}`}
          </div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${point.reconLabel}">
            📄 ${point.shortFile}
          </div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 5px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 4px;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 1px; background: ${color};"></span>
            <span style="color: #cbd5e1; font-size: 10px; font-weight: 500;">${seriesName}:</span>
            <strong style="color: #ffffff; font-size: 12px; font-family: monospace;">${point.count.toLocaleString()}</strong>
          </div>
        `;
      },
    },
    legend: {
      bottom: 40,
      left: 'center',
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 28,
      textStyle: {
        color: '#334155',
        fontSize: 12,
        fontWeight: 600,
      },
      data: ['Updated', 'Inserted', 'Missing'],
    },
    grid: {
      top: 40,
      left: 55,
      right: 30,
      bottom: 75,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      min: -0.8, // Distance offset away from left Y-axis
      max: Math.max(categories.length - 0.2, 0.8),
      interval: 1,
      axisLine: {
        onZero: false, // Prevents axis from sticking to 0
        lineStyle: { color: '#cbd5e1', width: 1.5 },
      },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: '#f1f5f9', type: 'dashed' },
      },
      axisLabel: {
        margin: 12,
        color: '#475569',
        fontSize: 11,
        fontWeight: 600,
        formatter: (val) => {
          const idx = Math.round(val);
          if (Math.abs(val - idx) < 0.1 && idx >= 0 && idx < categories.length) {
            if (categories.length > 12 && idx % 2 !== 0 && idx !== categories.length - 1) {
              return '';
            }
            return categories[idx];
          }
          return '';
        },
      },
    },
    yAxis: {
      type: 'value',
      name: 'Record Count',
      nameGap: 18,
      nameTextStyle: {
        color: '#475569',
        fontSize: 11,
        fontWeight: 600,
        align: 'right',
      },
      min: yMin, // Negative offset pushes 0 line UP away from bottom axis line
      axisLine: {
        show: true,
        onZero: false,
        lineStyle: { color: '#cbd5e1', width: 1.5 },
      },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: '#f1f5f9' },
      },
      axisLabel: {
        margin: 12,
        color: '#475569',
        fontSize: 11,
        fontWeight: 500,
        formatter: (v) => (v < 0 ? '' : v.toLocaleString()),
      },
    },
    series: [
      {
        name: 'Updated',
        type: 'scatter',
        data: updatedSeries,
        emphasis: {
          focus: 'series',
          scale: 1.4,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(245, 158, 11, 0.5)',
          },
        },
        itemStyle: {
          color: '#f59e0b', // Amber Gold
          shadowBlur: 3,
          shadowColor: 'rgba(0, 0, 0, 0.1)',
        },
      },
      {
        name: 'Inserted',
        type: 'scatter',
        data: insertedSeries,
        emphasis: {
          focus: 'series',
          scale: 1.4,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(59, 130, 246, 0.5)',
          },
        },
        itemStyle: {
          color: '#3b82f6', // Vibrant Blue
          shadowBlur: 3,
          shadowColor: 'rgba(0, 0, 0, 0.1)',
        },
      },
      {
        name: 'Missing',
        type: 'scatter',
        data: missingSeries,
        emphasis: {
          focus: 'series',
          scale: 1.4,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(239, 68, 68, 0.5)',
          },
        },
        itemStyle: {
          color: '#ef4444', // Vibrant Red
          shadowBlur: 3,
          shadowColor: 'rgba(0, 0, 0, 0.1)',
        },
      },
    ],
  });

  return (
    <div
      className="dash-panel reconciliation-cluster-panel"
      style={{
        background: '#ffffff',
        borderRadius: 18,
        padding: '24px 28px 20px 28px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.05)',
        marginTop: 24,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top Header with Title & Recon_id Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.4rem' }}>📊</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Reconciliation Point Distribution
            </h2>
          </div>
          <p style={{ margin: '3px 0 0 34px', color: '#64748b', fontSize: '0.86rem' }}>
            Updated / Inserted / Missing — clustered per reconciliation run
          </p>
        </div>

        {/* Header Right Actions: Recon_id Search Bar & Live Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Recon_id Search Bar Input */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                fontSize: 13,
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search Recon_id (e.g. R1, R2)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 30px 6px 30px',
                fontSize: '0.82rem',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                outline: 'none',
                width: 200,
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#2563eb';
                e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.12)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#cbd5e1';
                e.target.style.boxShadow = 'none';
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Clear search"
                style={{
                  position: 'absolute',
                  right: 8,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: 12,
                  padding: 2,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Live Monitoring Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 20,
              padding: '4px 10px',
              color: '#16a34a',
              fontSize: '0.76rem',
              fontWeight: 600,
              letterSpacing: '0.03em',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
              }}
            />
            LIVE
          </div>
        </div>
      </div>

      {/* Recon_id Count Filter Bar (Below Search Bar) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justify: 'space-between',
          gap: 12,
          marginBottom: 16,
          padding: '8px 14px',
          background: '#f8fafc',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Filter Recon_id Count:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#ffffff', padding: 3, borderRadius: 8, border: '1px solid #cbd5e1' }}>
            {[
              { key: '10', label: 'Last 10' },
              { key: '20', label: 'Last 20' },
              { key: '50', label: 'Last 50' },
              { key: 'custom', label: 'Custom' },
              { key: 'all', label: 'All' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setCountFilter(opt.key)}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: countFilter === opt.key ? '#2563eb' : 'transparent',
                  color: countFilter === opt.key ? '#ffffff' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom Count Input */}
          {countFilter === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Show last</span>
              <input
                type="number"
                min="1"
                max={rawChartData.length || 999}
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                style={{
                  width: 60,
                  padding: '3px 8px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#0f172a',
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>runs</span>
            </div>
          )}
        </div>

        <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 500 }}>
          {statusLabel}
        </span>
      </div>

      {/* Search Result Feedback Bar (if searching) */}
      {searchQuery && (
        <div
          style={{
            marginBottom: 14,
            padding: '6px 12px',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: 8,
            fontSize: '0.82rem',
            color: '#1e40af',
            display: 'flex',
            alignItems: 'center',
            justify: 'space-between',
          }}
        >
          <span>
            🔍 Filtered for Recon_id <strong>"{searchQuery}"</strong> — showing {chartData.length} of {rawChartData.length} run(s)
          </span>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.78rem',
            }}
          >
            Reset Filter
          </button>
        </div>
      )}

      {/* KPI Stats Strip */}
      {chartData.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
            marginBottom: 18,
            background: '#f8fafc',
            borderRadius: 12,
            padding: '10px 14px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>Total Runs</span>
            <strong style={{ fontSize: '1.15rem', color: '#0f172a', fontWeight: 700 }}>{totals.totalRuns}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 500 }}>🟡 Total Updated</span>
            <strong style={{ fontSize: '1.15rem', color: '#b45309', fontWeight: 700 }}>{totals.updated.toLocaleString()}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 500 }}>🔵 Total Inserted</span>
            <strong style={{ fontSize: '1.15rem', color: '#1d4ed8', fontWeight: 700 }}>{totals.inserted.toLocaleString()}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 500 }}>🔴 Total Missing</span>
            <strong style={{ fontSize: '1.15rem', color: '#b91c1c', fontWeight: 700 }}>{totals.missing.toLocaleString()}</strong>
          </div>
        </div>
      )}

      {/* Chart Canvas or Empty State */}
      {chartData.length === 0 ? (
        <div
          style={{
            height: 220,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justify: 'center',
            color: '#64748b',
            border: '1px dashed #cbd5e1',
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
            background: '#f8fafc',
          }}
        >
          <span style={{ fontSize: '1.8rem', marginBottom: 6 }}>🔍</span>
          <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
            {searchQuery ? `No Recon_id matches "${searchQuery}"` : 'No reconciliation comparisons recorded yet'}
          </p>
          <span style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>
            {searchQuery ? 'Try searching for Recon_id like R1, R2, 1, 2.' : 'Perform a reconciliation run to view cluster metrics.'}
          </span>
        </div>
      ) : (
        <div style={{ width: '100%', height: 390, position: 'relative' }}>
          <ReactECharts
            option={getOption()}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      )}
    </div>
  );
}
