import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import axios from 'axios';
import ChatWidget from './ChatWidget';
import LoginPage from './LoginPage';
import LandingPage from './LandingPage';
import { useAuth, authHeaders } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const THEMES = {
  dark: {
    '--bg': '#071029',
    '--panel': '#071830',
    '--muted': '#94a3b8',
    '--primary': '#06b6d4',
    '--accent': '#7c3aed',
    '--text': '#e6eefb',
  },
  light: {
    '--bg': '#f8fafc',
    '--panel': '#ffffff',
    '--muted': '#6b7280',
    '--primary': '#2563eb',
    '--accent': '#7c3aed',
    '--text': '#0f172a',
  },
  solar: {
    '--bg': '#10211f',
    '--panel': '#172a27',
    '--muted': '#f6c177',
    '--primary': '#f59e0b',
    '--accent': '#14b8a6',
    '--text': '#fff7ed',
  },
  midnight: {
    '--bg': '#020617',
    '--panel': '#030824',
    '--muted': '#8b9db0',
    '--primary': '#00d4ff',
    '--accent': '#9b5cff',
    '--text': '#dbeafe',
  },
};

// ── Lightweight inline icon set (no external icon library installed) ───────
const Icon = {
  Dashboard: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  Reconcile: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Files: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M4 6.5a2 2 0 0 1 2-2h3.5l1.6 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  Reports: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M6 3.5h9l3.5 3.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  Upload: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 15V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Layers: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3.5 12 12 16.5 20.5 12M3.5 16.5 12 21l8.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  Doc: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M6 3.5h8l4.5 4.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3.5V8h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  Clock: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  ArrowRight: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Trend: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M3.5 17 9 10.5l4 3.5 7-8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 5.5H20.5V10.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  File: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M6 3.5h8l4.5 4.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 3.5V8h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
};

function App() {
  const { user, token, logout, loading: authLoading } = useAuth();

  // ── General UI ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('dashboard');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);

  // ── Stored files & reports ───────────────────────────────────────────────
  const [reports, setReports] = useState([]);
  const [expandedReportFile, setExpandedReportFile] = useState(null);

  // ── Unified comparison (series-driven) ─────────────────────────────────────
  const [seriesList, setSeriesList] = useState([]);
  const [expandedSeriesId, setExpandedSeriesId] = useState(null);   // which baseline row is expanded, in the Stored Files tab
  const [seriesDetailCache, setSeriesDetailCache] = useState({});   // series_id → full versions array (lazy-loaded)
  const [seriesDetailLoading, setSeriesDetailLoading] = useState(null);
  const [activeSeries, setActiveSeries] = useState(null);      // { series, timeline }
  const [mode, setMode] = useState('new');                     // 'new' | 'series'
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [addingVersion, setAddingVersion] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);  // payload for results area
  const [versionReports, setVersionReports] = useState({});    // version → payload cache
  const [valueHistory, setValueHistory] = useState(null);      // { versions, entries } from Postgres
  const [historyStatus, setHistoryStatus] = useState('idle');  // 'idle' | 'loading' | 'ready' | 'unavailable'

  const [chatSeed, setChatSeed] = useState(null); // { text, context, nonce } — triggers ChatWidget to open + auto-ask

  const [newSeriesName, setNewSeriesName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadFile2, setUploadFile2] = useState(null);        // second file, only used in 'new' mode
  const [uploadKeyCol, setUploadKeyCol] = useState('');

  const uploadInputRef = useRef(null);
  const uploadInputRef2 = useRef(null);
  const dropRef = useRef(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const showToast = (message, timeout = 3000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    setToasts((items) => [...items, { id, message }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), timeout);
  };

  const applyTheme = (name) => {
    const theme = THEMES[name] || THEMES.dark;
    Object.entries(theme).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
    setCurrentTheme(name);
    localStorage.setItem('cr_theme', name);
  };

  const computeSummary = (report, beforeLabel, afterLabel) => {
    if (!report) return [];
    const total = report.full_comparison?.count || 0;
    const matched = total
      - (report.mismatches?.count || 0)
      - (report.format_inconsistencies?.count || 0)
      - (report.missing_in_target?.count || 0)
      - (report.missing_in_source?.count || 0)
      - (report.fuzzy_matches?.count || 0);
    return [
      [`${beforeLabel} Rows`, report.source_record_count],
      [`${afterLabel} Rows`, report.target_record_count],
      ['Matched Rows', Math.max(matched, 0)],
      ['Added', report.missing_in_source?.count],
      ['Deleted', report.missing_in_target?.count],
      ['Renamed (Fuzzy Matched)', report.fuzzy_matches?.count],
      ['Duplicates', (report.duplicates_source?.count || 0) + (report.duplicates_target?.count || 0)],
      ['Value Changes', report.mismatches?.count],
      ['Format Issues', report.format_inconsistencies?.count],
    ];
  };

  // Mirrors the churn-percent thresholds in backend/insights.py — used only
  // to pick a stable CSS class, independent of the exact wording of churn_label.
  const churnLevelKey = (pct) => {
    if (pct < 5) return 'very-stable';
    if (pct < 15) return 'mostly-stable';
    if (pct < 35) return 'moderate';
    return 'significant';
  };

  const buildPayload = (seriesData, version, report) => {
    const versions = seriesData.versions;
    const idx = versions.findIndex((v) => v.version === version);
    return {
      version,
      report,
      day_summary: report.day_summary || [],
      insights: report.insights || null,
      beforeLabel: versions[idx - 1]?.label || 'Previous',
      afterLabel: versions[idx]?.label || 'Current',
      reportFile: versions[idx]?.report_file,
      keyColumns: versions[idx]?.key_columns || [],
    };
  };

  // ── Fetchers ─────────────────────────────────────────────────────────────
  const fetchReports = async () => {
    const response = await axios.get(`${API_BASE}/api/reports`, { headers: authHeaders(token) });
    setReports(response.data.reports || []);
  };

  const fetchSeriesList = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/series`, { headers: authHeaders(token) });
      setSeriesList(res.data.series || []);
    } catch { /* silent */ }
  };

  // Baseline row in the Stored Files tab is collapsed by default and only
  // shows its target files once opened — lazy-fetch the full version list
  // (with per-file timestamps) the first time, then reuse it.
  const toggleSeriesExpand = async (seriesId) => {
    if (expandedSeriesId === seriesId) { setExpandedSeriesId(null); return; }
    setExpandedSeriesId(seriesId);
    if (seriesDetailCache[seriesId]) return;
    setSeriesDetailLoading(seriesId);
    try {
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`, { headers: authHeaders(token) });
      setSeriesDetailCache((prev) => ({ ...prev, [seriesId]: res.data.series.versions || [] }));
    } catch {
      showToast('Could not load files for this comparison.');
    } finally {
      setSeriesDetailLoading(null);
    }
  };

  const fetchValueHistory = async (seriesId) => {
    setHistoryStatus('loading');
    try {
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}/history`, { headers: authHeaders(token) });
      setValueHistory({ versions: res.data.versions || [], entries: res.data.entries || [] });
      setHistoryStatus('ready');
    } catch (err) {
      setValueHistory(null);
      setHistoryStatus('unavailable');
    }
  };

  // ── Series flow ────────────────────────────────────────────────────────────
  const startNew = () => {
    setMode('new');
    setActiveSeries(null);
    setSelectedVersion(null);
    setSelectedReport(null);
    setVersionReports({});
    setUploadFile(null);
    setUploadFile2(null);
    setUploadKeyCol('');
    setNewSeriesName('');
    setError('');
  };

  const openSeries = async (seriesId) => {
    setSeriesLoading(true);
    setError('');
    setVersionReports({});
    setUploadFile(null);
    setUploadFile2(null);
    setUploadKeyCol('');
    try {
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`, { headers: authHeaders(token) });
      const seriesData = res.data.series;
      setActiveSeries(res.data);
      setMode('series');
      fetchValueHistory(seriesId);
      const versions = seriesData.versions;
      const latest = versions[versions.length - 1];
      if (latest && latest.version > 0) {
        setSelectedVersion(latest.version);
        const rep = await axios.get(`${API_BASE}/api/series/${seriesId}/versions/${latest.version}/report`, { headers: authHeaders(token) });
        const payload = buildPayload(seriesData, latest.version, rep.data.report);
        setVersionReports({ [latest.version]: payload });
        setSelectedReport(payload);
      } else {
        setSelectedVersion(0);
        setSelectedReport(null);
      }
    } catch {
      showToast('Could not load series.');
    } finally {
      setSeriesLoading(false);
    }
  };

  const selectVersion = async (version) => {
    if (!activeSeries) return;
    setSelectedVersion(version);
    if (version === 0) { setSelectedReport(null); return; }
    if (versionReports[version]) { setSelectedReport(versionReports[version]); return; }
    try {
      const res = await axios.get(`${API_BASE}/api/series/${activeSeries.series.series_id}/versions/${version}/report`, { headers: authHeaders(token) });
      const payload = buildPayload(activeSeries.series, version, res.data.report);
      setVersionReports((prev) => ({ ...prev, [version]: payload }));
      setSelectedReport(payload);
    } catch {
      showToast('Could not load diff for this version.');
    }
  };

  const createSeries = async () => {
    if (!uploadFile) { showToast('Please pick a baseline file first.'); return; }
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (newSeriesName.trim()) fd.append('name', newSeriesName.trim());
    try {
      setSeriesLoading(true);
      setError('');
      const res = await axios.post(`${API_BASE}/api/series`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      const seriesId = res.data.series.series_id;

      if (uploadFile2) {
        const fd2 = new FormData();
        fd2.append('file', uploadFile2);
        if (uploadKeyCol.trim()) fd2.append('key_columns', uploadKeyCol.trim());
        try {
          await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd2, {
            headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
          });
        } catch (err) {
          showToast(err.response?.data?.error || 'Baseline created, but the second file could not be compared.');
        }
      }

      await fetchSeriesList();
      showToast(
        uploadFile2
          ? `Series "${res.data.series.name}" created — first comparison ready`
          : `Series "${res.data.series.name}" created — upload the next file to compare`
      );
      await openSeries(seriesId);
      await fetchReports();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create series.');
    } finally {
      setSeriesLoading(false);
    }
  };

  const addVersion = async () => {
    if (!uploadFile) { showToast('Please pick a file to compare first.'); return; }
    const seriesId = activeSeries.series.series_id;
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (uploadKeyCol.trim()) fd.append('key_columns', uploadKeyCol.trim());
    try {
      setAddingVersion(true);
      setError('');
      await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      setSeriesDetailCache((prev) => { const next = { ...prev }; delete next[seriesId]; return next; });
      await fetchSeriesList();
      await openSeries(seriesId);
      await fetchReports();
      showToast('File compared — results ready');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not compare file.');
    } finally {
      setAddingVersion(false);
    }
  };

  const deleteSeries = async (seriesId, name) => {
    if (!window.confirm(`Delete comparison "${name}" and all its versions?`)) return;
    try {
      await axios.delete(`${API_BASE}/api/series/${seriesId}`, { headers: authHeaders(token) });
      if (activeSeries?.series?.series_id === seriesId) startNew();
      if (expandedSeriesId === seriesId) setExpandedSeriesId(null);
      setSeriesDetailCache((prev) => { const next = { ...prev }; delete next[seriesId]; return next; });
      await fetchSeriesList();
      showToast('Comparison deleted');
    } catch {
      showToast('Could not delete comparison.');
    }
  };

  const deleteAllSeries = async () => {
    if (!seriesList.length) { showToast('No comparisons to delete.'); return; }
    if (!window.confirm(`Delete ALL ${seriesList.length} comparisons and every file in them? This cannot be undone.`)) return;
    try {
      const res = await axios.delete(`${API_BASE}/api/series`, { headers: authHeaders(token) });
      startNew();
      setExpandedSeriesId(null);
      setSeriesDetailCache({});
      await fetchSeriesList();
      showToast(`Deleted ${res.data.count} comparison${res.data.count !== 1 ? 's' : ''}`);
    } catch {
      showToast('Could not delete all comparisons.');
    }
  };

  // ── Reports ──────────────────────────────────────────────────────────────
  const deleteReport = async (filename) => {
    if (!window.confirm(`Delete report "${filename}"?`)) return;
    try {
      await axios.delete(`${API_BASE}/api/reports/${filename}`, { headers: authHeaders(token) });
      setReports((items) => items.filter((r) => r.filename !== filename));
      showToast('Report deleted');
    } catch {
      showToast('Could not delete report.');
    }
  };

  const deleteAllReports = async () => {
    if (!reports.length) { showToast('No reports to delete.'); return; }
    if (!window.confirm(`Delete ALL ${reports.length} reports? This cannot be undone.`)) return;
    try {
      const res = await axios.delete(`${API_BASE}/api/reports`, { headers: authHeaders(token) });
      setReports([]);
      showToast(`Deleted ${res.data.count} report${res.data.count !== 1 ? 's' : ''}`);
    } catch {
      showToast('Could not delete all reports.');
    }
  };

  const formatReportName = (filename) => {
    const base = filename.replace(/_report\.xlsx$/, '').replace(/\.xlsx$/, '');
    const tsMatch = base.match(/^(\d{8}T\d{6}Z)_(.+)$/);
    if (!tsMatch) return { label: filename, timestamp: '' };
    const ts = tsMatch[1];
    const rest = tsMatch[2].replace(/_vs_/g, ' vs ').replace(/_xlsx/g, '.xlsx').replace(/_/g, ' ');
    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)} UTC`;
    return { label: rest, timestamp: date };
  };

  const downloadReport = (filename) => {
    if (!filename) return;
    window.open(`${API_BASE}/api/reports/${filename}`, '_blank');
  };

  // Opens the floating chat widget pre-selected to the given dataset
  // (series) + version, with an initial question pre-sent. The widget
  // itself loads the reconciliation context fresh from the backend using
  // seriesId/version — no report data is passed through the frontend here.
  const askAboutReport = (seriesId, version) => {
    if (!seriesId) return;
    setChatSeed({
      text: 'Explain this reconciliation report in business language.',
      seriesId,
      version,
      nonce: Date.now(),
    });
  };

  const formatUploadedAt = (isoString) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    applyTheme(localStorage.getItem('cr_theme') || 'dark');
    fetchReports().catch(() => {});
    fetchSeriesList().catch(() => {});
  }, []);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return undefined;
    const handleDrop = (event) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files[0]) setUploadFile(files[0]);
      el.classList.remove('drag-over');
    };
    const handleDragOver = (event) => { event.preventDefault(); el.classList.add('drag-over'); };
    const handleDragLeave = () => el.classList.remove('drag-over');
    el.addEventListener('drop', handleDrop);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    return () => {
      el.removeEventListener('drop', handleDrop);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
    };
  }, [mode]);

  // ── Row renderers (shared by every results table) ──────────────────────────
  const renderRows = (rows = [], statusLabel = '') => {
    const cleanRows = rows.map((row) => {
      const { _reconciliation_key, ...rest } = row;
      return rest;
    });
    const columns = cleanRows.length
      ? Array.from(cleanRows.reduce((set, row) => { Object.keys(row).forEach((k) => set.add(k)); return set; }, new Set()))
      : [];
    if (!cleanRows.length) return <p className="muted">No records.</p>;
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {statusLabel && <th>Status</th>}
              {columns.map((col) => <th key={col}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {cleanRows.slice(0, 100).map((row, idx) => (
              <tr key={idx}>
                {statusLabel && <td><span className="status-badge status-neutral">{statusLabel}</span></td>}
                {columns.map((col) => (
                  <td key={col}>{typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {cleanRows.length > 100 && <p className="muted">Showing first 100 of {cleanRows.length} records. Download the Excel report for the full list.</p>}
      </div>
    );
  };

  const renderIssueRows = (rows = [], beforeLabel = 'Source', afterLabel = 'Target') => {
    if (!rows.length) return <p className="muted">No records.</p>;
    const sample = rows.find((r) => r.source_row && r.target_row) || rows[0];
    const sourceCols = Object.keys(sample.source_row || {});
    const targetCols = Object.keys(sample.target_row || {});
    const commonCols = sourceCols.filter((c) => targetCols.includes(c) && !Object.keys(sample.key || {}).includes(c));
    const keyCols = Object.keys(sample.key || {});
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              {keyCols.map((k) => <th key={k}>Key: {k}</th>)}
              <th>Changed Columns</th>
              {commonCols.map((col) => (
                <th key={col} colSpan={2} className="pair-header">{col}</th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              {keyCols.map((k) => <th key={`sub-${k}`}></th>)}
              <th></th>
              {commonCols.map((col) => (
                <Fragment key={`${col}-hdr`}>
                  <th>{beforeLabel}</th>
                  <th>{afterLabel}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, idx) => {
              const changed = row.changed_columns || (row.differences || []).map((d) => d.column);
              return (
                <tr key={idx}>
                  <td>{row.date}</td>
                  {keyCols.map((k) => <td key={k}>{row.key?.[k]}</td>)}
                  <td><span className="status-badge status-updated">{changed.join(', ') || '—'}</span></td>
                  {commonCols.map((col) => {
                    const isChanged = changed.includes(col);
                    const beforeVal = row.source_row?.[col] ?? '';
                    const afterVal = row.target_row?.[col] ?? '';
                    return (
                      <Fragment key={col}>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(beforeVal)}</td>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(afterVal)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 100 && <p className="muted">Showing first 100 of {rows.length} records. Download the Excel report for the full list.</p>}
      </div>
    );
  };

  // Rows where the key text didn't match exactly between files, but vector
  // similarity search found a very likely same-record match anyway (e.g.
  // "Alpha Proj" -> "Project Alpha") — shown with a confidence score so a
  // person can sanity-check it, instead of it silently vanishing as a
  // false Deleted + Added pair.
  const renderFuzzyRows = (rows = [], beforeLabel = 'Source', afterLabel = 'Target') => {
    if (!rows.length) return <p className="muted">No renamed/fuzzy-matched rows found.</p>;
    const sample = rows.find((r) => r.source_row && r.target_row) || rows[0];
    const sourceCols = Object.keys(sample.source_row || {});
    const targetCols = Object.keys(sample.target_row || {});
    const keyCols = Object.keys(sample.key_before || sample.key_after || {});
    const commonCols = sourceCols.filter((c) => targetCols.includes(c) && !keyCols.includes(c));
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Confidence</th>
              {keyCols.map((k) => <th key={`before-${k}`}>{beforeLabel} Key: {k}</th>)}
              {keyCols.map((k) => <th key={`after-${k}`}>{afterLabel} Key: {k}</th>)}
              <th>Changed Columns</th>
              {commonCols.map((col) => (
                <th key={col} colSpan={2} className="pair-header">{col}</th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              {keyCols.map((k) => <th key={`sub-before-${k}`}></th>)}
              {keyCols.map((k) => <th key={`sub-after-${k}`}></th>)}
              <th></th>
              {commonCols.map((col) => (
                <Fragment key={`${col}-hdr`}>
                  <th>{beforeLabel}</th>
                  <th>{afterLabel}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, idx) => {
              const changed = row.changed_columns || [];
              const confidencePct = Math.round((row.confidence || 0) * 100);
              return (
                <tr key={idx}>
                  <td><span className="status-badge status-renamed">{confidencePct}%</span></td>
                  {keyCols.map((k) => <td key={`b-${k}`}>{row.key_before?.[k]}</td>)}
                  {keyCols.map((k) => <td key={`a-${k}`}>{row.key_after?.[k]}</td>)}
                  <td><span className="status-badge status-updated">{changed.join(', ') || '(key only)'}</span></td>
                  {commonCols.map((col) => {
                    const isChanged = changed.includes(col);
                    const beforeVal = row.source_row?.[col] ?? '';
                    const afterVal = row.target_row?.[col] ?? '';
                    return (
                      <Fragment key={col}>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(beforeVal)}</td>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(afterVal)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 100 && <p className="muted">Showing first 100 of {rows.length} records. Download the Excel report for the full list.</p>}
      </div>
    );
  };

  const renderFullComparison = (rows = [], beforeLabel = 'Source', afterLabel = 'Target') => {
    if (!rows.length) return <p className="muted">No records.</p>;
    const sample = rows.find((r) => r.source_row && Object.keys(r.source_row).length && r.target_row && Object.keys(r.target_row).length) || rows[0];
    const sourceCols = Object.keys(sample.source_row || {});
    const targetCols = Object.keys(sample.target_row || {});
    const keyCols = Object.keys(sample.key || {});
    const commonCols = sourceCols.filter((c) => targetCols.includes(c) && !keyCols.includes(c));
    const badgeClass = (status) => ({
      Matched: 'status-matched',
      Updated: 'status-updated',
      'Format Only': 'status-updated',
      Deleted: 'status-deleted',
      Added: 'status-added',
      Renamed: 'status-renamed',
    }[status] || 'status-neutral');
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              {keyCols.map((k) => <th key={k}>Key: {k}</th>)}
              {commonCols.map((col) => (
                <th key={col} colSpan={2} className="pair-header">{col}</th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              {keyCols.map((k) => <th key={`sub-${k}`}></th>)}
              {commonCols.map((col) => (
                <Fragment key={`${col}-hdr`}>
                  <th>{beforeLabel}</th>
                  <th>{afterLabel}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 150).map((row, idx) => {
              const changed = row.changed_columns || [];
              return (
                <tr key={idx} className={row.status === 'Deleted' ? 'row-deleted' : row.status === 'Added' ? 'row-added' : ''}>
                  <td><span className={`status-badge ${badgeClass(row.status)}`}>{row.status}</span></td>
                  {keyCols.map((k) => <td key={k}>{row.key?.[k]}</td>)}
                  {commonCols.map((col) => {
                    const isChanged = changed.includes(col);
                    const beforeVal = row.source_row?.[col] ?? '';
                    const afterVal = row.target_row?.[col] ?? '';
                    return (
                      <Fragment key={col}>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(beforeVal)}</td>
                        <td className={isChanged ? 'cell-changed' : ''}>{String(afterVal)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 150 && <p className="muted">Showing first 150 of {rows.length} records. Download the Excel report for the full list.</p>}
      </div>
    );
  };

  // ── Small dependency-free SVG pie chart for the day-wise breakdown ─────────
  const polarToCartesian = (cx, cy, r, angleDeg) => {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180.0;
    return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
  };

  const describeArc = (cx, cy, r, startAngle, endAngle) => {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return ['M', cx, cy, 'L', start.x, start.y, 'A', r, r, 0, largeArcFlag, 0, end.x, end.y, 'Z'].join(' ');
  };

  const DayWisePieChart = ({ segments }) => {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    const size = 200;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;

    let cursor = 0;
    const slices = total > 0 ? segments.filter((s) => s.value > 0).map((s) => {
      const startAngle = cursor;
      const sliceAngle = (s.value / total) * 360;
      cursor += sliceAngle;
      const endAngle = cursor;
      // Full-circle edge case: a single 360° slice needs two arcs to render.
      if (sliceAngle >= 359.999) {
        return { ...s, path: `M ${cx - r},${cy} A ${r},${r} 0 1,0 ${cx + r},${cy} A ${r},${r} 0 1,0 ${cx - r},${cy} Z` };
      }
      return { ...s, path: describeArc(cx, cy, r, startAngle, endAngle) };
    }) : [];

    return (
      <div className="pie-chart-wrap">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="pie-chart-svg">
          {total > 0 ? (
            slices.map((s) => (
              <path key={s.label} d={s.path} fill={s.color} stroke="var(--panel)" strokeWidth="1.5">
                <title>{`${s.label}: ${s.value} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
              </path>
            ))
          ) : (
            <circle cx={cx} cy={cy} r={r} fill="var(--card-border)" />
          )}
        </svg>
        <div className="pie-legend">
          {total > 0 ? segments.filter((s) => s.value > 0).map((s) => (
            <div key={s.label} className="pie-legend-item">
              <span className="pie-swatch" style={{ background: s.color }} />
              <span className="pie-legend-label">{s.label}</span>
              <span className="pie-legend-value">{s.value} · {((s.value / total) * 100).toFixed(1)}%</span>
            </div>
          )) : <p className="muted">No discrepancies to chart — everything matched.</p>}
        </div>
      </div>
    );
  };

  // ── Timeline chart: how added/deleted/duplicates/value-changes/format
  // issues moved from file to file, built from the series' version history —
  // one 3D-look stacked bar per uploaded file (Source baseline + every Day N
  // target), so a new bar simply appears whenever another file is added.
  // Pure SVG (front/side/top faces via sheared polygons) — no 3D library. ────
  const InsightsTimelineChart = ({ timeline }) => {
    const categories = [
      { key: 'added', label: 'Added', color: '#22c55e', dark: '#15803d', light: '#4ade80' },
      { key: 'deleted', label: 'Deleted', color: '#ef4444', dark: '#b91c1c', light: '#f87171' },
      { key: 'duplicates', label: 'Duplicates', color: '#f59e0b', dark: '#b45309', light: '#fbbf24' },
      { key: 'value_changes', label: 'Value Changes', color: '#3b82f6', dark: '#1d4ed8', light: '#60a5fa' },
      { key: 'format_issues', label: 'Format Issues', color: '#a855f7', dark: '#7e22ce', light: '#c084fc' },
    ];

    const wrapRef = useRef(null);
    const [hovered, setHovered] = useState(null); // { index, x, y }

    const width = 720;
    const height = 320;
    const n = timeline.length;

    const totals = timeline.map((d) => categories.reduce((sum, c) => sum + (d[c.key] || 0), 0));
    const maxTotal = Math.max(1, ...totals);

    const barWidth = Math.max(6, Math.min(34, (width - 70) / Math.max(n, 1) * 0.55));
    const depthX = Math.max(3, Math.min(9, barWidth * 0.35));
    const depthY = -depthX * 1.1;

    const margin = { top: 24 + Math.abs(depthY), right: 20 + depthX, bottom: 52, left: 44 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const step = n > 1 ? plotW / n : plotW;
    const xAt = (i) => margin.left + i * step + (step - barWidth) / 2;
    const yBase = margin.top + plotH;
    const yAt = (v) => yBase - (v / maxTotal) * plotH;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f));
    const labelStride = Math.max(1, Math.ceil(n / 10));

    const handleEnter = (i, evt) => {
      const wrapBox = wrapRef.current.getBoundingClientRect();
      const targetBox = evt.currentTarget.getBoundingClientRect();
      setHovered({
        index: i,
        x: targetBox.left - wrapBox.left + targetBox.width / 2,
        y: targetBox.top - wrapBox.top,
      });
    };

    return (
      <div className="timeline-chart-wrap" ref={wrapRef}>
        <svg viewBox={`0 0 ${width} ${height}`} className="timeline-chart-svg">
          {gridLines.map((v, i) => (
            <g key={i}>
              <line x1={margin.left} x2={width - margin.right} y1={yAt(v)} y2={yAt(v)} stroke="var(--card-border)" strokeWidth="1" />
              <text x={margin.left - 8} y={yAt(v)} textAnchor="end" dominantBaseline="middle" className="timeline-axis-label">{v}</text>
            </g>
          ))}

          {timeline.map((d, i) => (
            i % labelStride === 0 && (
              <text
                key={d.date}
                x={xAt(i) + barWidth / 2}
                y={height - margin.bottom + 16}
                textAnchor="end"
                className="timeline-axis-label"
                transform={`rotate(-35 ${xAt(i) + barWidth / 2} ${height - margin.bottom + 16})`}
              >
                {d.date}
              </text>
            )
          ))}

          {timeline.map((d, i) => {
            const x = xAt(i);
            let cum = 0;
            const nonZero = categories.filter((c) => (d[c.key] || 0) > 0);
            const segments = nonZero.map((c, segIdx) => {
              const value = d[c.key] || 0;
              const yBottom = yAt(cum);
              const yTop = yAt(cum + value);
              cum += value;
              return { ...c, value, yBottom, yTop, isTop: segIdx === nonZero.length - 1 };
            });

            return (
              <g key={d.date}>
                {segments.length === 0 ? (
                  <rect
                    x={x} y={yBase - 10} width={barWidth} height={10} rx="2"
                    fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 2"
                  />
                ) : segments.map((seg) => (
                  <g key={seg.key}>
                    <rect x={x} y={seg.yTop} width={barWidth} height={Math.max(seg.yBottom - seg.yTop, 0.5)} fill={seg.color} />
                    <polygon
                      points={`${x + barWidth},${seg.yBottom} ${x + barWidth + depthX},${seg.yBottom + depthY} ${x + barWidth + depthX},${seg.yTop + depthY} ${x + barWidth},${seg.yTop}`}
                      fill={seg.dark}
                    />
                    {seg.isTop && (
                      <polygon
                        points={`${x},${seg.yTop} ${x + barWidth},${seg.yTop} ${x + barWidth + depthX},${seg.yTop + depthY} ${x + depthX},${seg.yTop + depthY}`}
                        fill={seg.light}
                      />
                    )}
                  </g>
                ))}
                {/* Larger invisible hit-area so hovering near the bar (including its depth) reliably triggers the tooltip. */}
                <rect
                  x={x - 2} y={margin.top - 4} width={barWidth + depthX + 4} height={plotH + 8}
                  fill="transparent"
                  onMouseEnter={(e) => handleEnter(i, e)}
                  onMouseLeave={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="timeline-tooltip" style={{ left: hovered.x, top: hovered.y }}>
            <div className="timeline-tooltip-date">{timeline[hovered.index].date}</div>
            {totals[hovered.index] === 0 ? (
              <div className="timeline-tooltip-row" style={{ justifyContent: 'flex-start', gap: 6 }}>
                <span>{timeline[hovered.index].rowCount ?? 0} records</span>
                <span className="muted">· No changes</span>
              </div>
            ) : (
              <>
                {categories.map((c) => (
                  <div key={c.key} className="timeline-tooltip-row">
                    <span className="pie-swatch" style={{ background: c.color }} />
                    <span className="timeline-tooltip-label">{c.label}</span>
                    <strong>{timeline[hovered.index][c.key] || 0}</strong>
                  </div>
                ))}
                <div className="timeline-tooltip-row timeline-tooltip-total">
                  <span>Total</span>
                  <strong>{totals[hovered.index]}</strong>
                </div>
              </>
            )}
          </div>
        )}

        <div className="timeline-legend">
          {categories.map((c) => (
            <div key={c.key} className="pie-legend-item">
              <span className="pie-swatch" style={{ background: c.color }} />
              <span className="pie-legend-label">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Full reconcile-style results block for one version diff ────────────────
  const renderResults = (payload) => {
    const { report, day_summary, insights, beforeLabel, afterLabel, reportFile, keyColumns, version } = payload;
    const cards = computeSummary(report, beforeLabel, afterLabel);
    return (
      <>
        <section className="content-card result-section">
          <div className="top-row">
            <h2>Comparison Summary <span className="muted" style={{ fontWeight: 600 }}>— {beforeLabel} → {afterLabel}</span></h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="pill">Keys: {keyColumns?.length ? keyColumns.join(', ') : 'auto-detected'}</span>
              {reportFile && <button type="button" className="secondary" onClick={() => downloadReport(reportFile)}>⬇ Excel Report</button>}
            </div>
          </div>
          <div className="cards">
            {cards.map(([label, value]) => (
              <div key={label} className="card">
                <h3>{label}</h3>
                <p>{value ?? 0}</p>
              </div>
            ))}
          </div>
          <div className="schema-grid">
            <div><strong>{beforeLabel}-only columns:</strong> {(report.schema?.source_only_columns || []).join(', ') || 'None'}</div>
            <div><strong>{afterLabel}-only columns:</strong> {(report.schema?.target_only_columns || []).join(', ') || 'None'}</div>
          </div>
        </section>

        <section className="content-card result-section">
          <h2>Day-wise Report</h2>

          {insights?.narrative?.length ? (
            <div className="insights-panel">
              <div className="insights-header">
                <h3>What's happening in this data</h3>
                <span className={`churn-badge churn-${churnLevelKey(insights.churn_percent)}`}>
                  {insights.churn_label} · {insights.churn_percent}% of rows touched
                </span>
              </div>
              <ul className="insights-list">
                {insights.narrative.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
              {(() => {
                // One bar per uploaded target file (Day N) — the Source
                // baseline is excluded since it has nothing to compare
                // against, so it never has a meaningful bar here.
                const versions = activeSeries?.series?.versions || [];
                const fileTimeline = versions.filter((v) => v.version > 0).map((v) => ({
                  date: v.label || `Day ${v.version}`,
                  rowCount: v.row_count || 0,
                  added: v.diff_summary?.added || 0,
                  deleted: v.diff_summary?.deleted || 0,
                  duplicates: v.diff_summary?.duplicates || 0,
                  value_changes: v.diff_summary?.updated || 0,
                  format_issues: v.diff_summary?.format_issues || 0,
                }));
                if (fileTimeline.length >= 1) {
                  return (
                    <div className="insights-timeline">
                      <span className="muted" style={{ fontSize: '0.85rem' }}>Changes over time, by file — one bar per uploaded file:</span>
                      <InsightsTimelineChart timeline={fileTimeline} />
                    </div>
                  );
                }
                return null;
              })()}

              <div className="ai-explain-panel">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => askAboutReport(activeSeries?.series?.series_id, version)}
                >
                  🤖 Ask AI about this report
                </button>
              </div>
            </div>
          ) : null}

          {day_summary?.length ? (
            <div className="day-wise-viz">
              <DayWisePieChart segments={[
                { label: 'Deleted', value: day_summary.reduce((sum, d) => sum + (d.missing_in_target || 0), 0), color: '#ef4444' },
                { label: 'Added', value: day_summary.reduce((sum, d) => sum + (d.missing_in_source || 0), 0), color: '#22c55e' },
                { label: 'Duplicates', value: day_summary.reduce((sum, d) => sum + (d.duplicates_source || 0) + (d.duplicates_target || 0), 0), color: '#f59e0b' },
                { label: 'Value Changes', value: day_summary.reduce((sum, d) => sum + (d.mismatches || 0), 0), color: '#3b82f6' },
                { label: 'Format Issues', value: day_summary.reduce((sum, d) => sum + (d.format_inconsistencies || 0), 0), color: '#a855f7' },
              ]} />
            </div>
          ) : <p className="muted">No shared date column was found, so day-wise grouping was skipped.</p>}
        </section>

        <section className="content-card result-section">
          <div className="top-row">
            <h2>Value History Over Time <span className="muted" style={{ fontWeight: 600 }}>— baseline stored in Postgres</span></h2>
            {historyStatus === 'ready' && <span className="pill">{valueHistory?.entries?.length || 0} changed values</span>}
          </div>
          {historyStatus === 'loading' && <p className="muted">Loading history…</p>}
          {historyStatus === 'unavailable' && (
            <p className="muted">
              Day-over-day value history needs the Postgres <code>db</code> service running (see <code>docker-compose.yml</code>).
              Everything else still works without it — this panel just stays empty.
            </p>
          )}
          {historyStatus === 'ready' && (!valueHistory?.entries?.length ? (
            <p className="muted">No changed values tracked yet — this fills in as more days get compared.</p>
          ) : (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Column</th>
                    {valueHistory.versions.map((v) => <th key={v.version}>{v.label || `Day ${v.version}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {valueHistory.entries.map((entry, i) => (
                    <tr key={`${entry.row_key}-${entry.column}-${i}`}>
                      <td>{entry.row_key}</td>
                      <td>{entry.column}</td>
                      {valueHistory.versions.map((v) => {
                        const val = entry.values[String(v.version)];
                        const prevVersion = valueHistory.versions[valueHistory.versions.findIndex((vv) => vv.version === v.version) - 1];
                        const prevVal = prevVersion ? entry.values[String(prevVersion.version)] : undefined;
                        const isChangeFromPrev = prevVersion && val !== undefined && prevVal !== undefined && val !== prevVal;
                        return (
                          <td key={v.version} className={isChangeFromPrev ? 'history-cell-changed' : undefined}>
                            {val === undefined ? <span className="muted">—</span> : val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      </>
    );
  };

  // ── Discrepancies detail (moved out of the home Reconcile view — now
  // shown per-file under the Reports tab, since that's where a report's
  // row-level detail belongs once it's been saved). ──────────────────────────
  const renderDiscrepancies = (report, beforeLabel, afterLabel) => (
    <section className="content-card result-section">
      <h2>Discrepancies</h2>
      <details open><summary>All rows, side by side ({report.full_comparison?.count || 0})</summary>{renderFullComparison(report.full_comparison?.rows, beforeLabel, afterLabel)}</details>
      <details><summary>Deleted — missing in {afterLabel} ({report.missing_in_target?.count || 0})</summary>{renderRows(report.missing_in_target?.rows, 'Deleted')}</details>
      <details><summary>Added — new in {afterLabel} ({report.missing_in_source?.count || 0})</summary>{renderRows(report.missing_in_source?.rows, 'Added')}</details>
      <details><summary>{beforeLabel} duplicates ({report.duplicates_source?.count || 0})</summary>{renderRows(report.duplicates_source?.rows)}</details>
      <details><summary>{afterLabel} duplicates ({report.duplicates_target?.count || 0})</summary>{renderRows(report.duplicates_target?.rows)}</details>
      <details><summary>Value changes ({report.mismatches?.count || 0})</summary>{renderIssueRows(report.mismatches?.rows, beforeLabel, afterLabel)}</details>
      <details><summary>Renamed — fuzzy-matched keys ({report.fuzzy_matches?.count || 0})</summary>{renderFuzzyRows(report.fuzzy_matches?.rows, beforeLabel, afterLabel)}</details>
      <details><summary>Format inconsistencies ({report.format_inconsistencies?.count || 0})</summary>{renderIssueRows(report.format_inconsistencies?.rows, beforeLabel, afterLabel)}</details>
    </section>
  );

  const latestLabel = activeSeries?.series?.versions?.slice(-1)[0]?.label;

  // ── Dashboard summary data (derived from data already fetched for the
  // Stored Files / Reports tabs — no extra API calls needed) ────────────────
  const dashboardStats = useMemo(() => {
    const totalFiles = seriesList.reduce((sum, s) => sum + 1 + (s.target_count || 0), 0);
    const totalComparisons = seriesList.length;
    const totalReports = reports.length;

    // Recent activity feed: baseline uploads (known timestamp) + saved reports
    // (also timestamped) merged and sorted, most recent first.
    const baselineEntries = seriesList
      .filter((s) => s.baseline?.uploaded_at || s.created_at)
      .map((s) => ({
        name: s.baseline?.filename || s.name,
        date: s.baseline?.uploaded_at || s.created_at,
        kind: 'Dataset upload',
      }));

    const reportEntries = reports.map((r) => {
      const { label, timestamp } = formatReportName(r.filename);
      // timestamp string is "YYYY-MM-DD HH:MM:SS UTC" — convert back to a Date for sorting
      const iso = timestamp ? timestamp.replace(' ', 'T').replace(' UTC', 'Z') : null;
      return {
        name: label || r.filename,
        date: iso,
        kind: 'Report generated',
      };
    });

    const recent = [...baselineEntries, ...reportEntries]
      .filter((e) => e.date && !Number.isNaN(new Date(e.date).getTime()))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6);

    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const thisWeekCount = [...baselineEntries, ...reportEntries].filter(
      (e) => e.date && now - new Date(e.date).getTime() <= weekMs
    ).length;

    // Small "files per comparison" breakdown for the bar visual — top 5 by size.
    const topComparisons = [...seriesList]
      .sort((a, b) => (b.target_count || 0) - (a.target_count || 0))
      .slice(0, 5)
      .map((s) => ({ name: s.name, count: 1 + (s.target_count || 0) }));
    const maxComparisonCount = Math.max(1, ...topComparisons.map((c) => c.count));

    return { totalFiles, totalComparisons, totalReports, recent, thisWeekCount, topComparisons, maxComparisonCount };
  }, [seriesList, reports]);

  // While validating a stored token, render nothing to avoid a flash of the
  // dashboard before the redirect to LoginPage.
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg,#071029)', color: 'var(--muted,#94a3b8)' }}>
        Loading…
      </div>
    );
  }

  // Not logged in — show the landing page.
  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <img src="/favicon.svg" alt="logo" style={{ height: 36 }} />
          <div className="brand-copy">
            <span className="brand-name">Reconciliation</span>
          </div>
        </div>
        <nav className="nav">
          <button className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveView('dashboard')}><Icon.Dashboard /> Dashboard</button>
          <button className={`nav-item ${activeView === 'reconcile' ? 'active' : ''}`} onClick={() => setActiveView('reconcile')}><Icon.Reconcile /> Reconcile</button>
          <button className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}><Icon.Files /> Stored Files</button>
          <button className={`nav-item ${activeView === 'reports' ? 'active' : ''}`} onClick={() => setActiveView('reports')}><Icon.Reports /> Reports</button>
        </nav>
      </aside>

      <main className="main-area">
        <div className="content-container">
          <header className="app-header">
            <div className="header-brand">
              <div className="header-title">Reconciliation</div>
              <div className="header-subtitle">Upload files over time — every version is reconciled against the previous one</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {/* ── Logged-in user badge + logout ─────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '20px',
                  padding: '0.3rem 0.8rem',
                  fontSize: '0.82rem',
                  color: 'var(--muted)',
                  fontWeight: 500,
                }}>
                  👤 {user?.full_name}
                </span>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.82rem' }}
                  onClick={logout}
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
              {/* ── Theme picker ──────────────────────────────────────── */}
              <div className="theme-anchor">
                <button id="cr-avatar" className={`avatar ${themeMenuOpen ? 'open' : ''}`} onClick={() => setThemeMenuOpen((open) => !open)} aria-label="Theme menu">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="9" cy="9" r="5.5" stroke="white" strokeWidth="2" />
                    <circle cx="15" cy="15" r="5.5" stroke="white" strokeWidth="2" />
                  </svg>
                </button>
                {themeMenuOpen && (
                  <div className="theme-popover" role="menu">
                    <div className="theme-popover-title">Theme</div>
                    <div className="theme-popover-grid">
                      {Object.keys(THEMES).map((name) => (
                        <button key={name} className={`theme-compact ${currentTheme === name ? 'active' : ''}`} onClick={() => { applyTheme(name); setThemeMenuOpen(false); }}>
                          <div className={`theme-swatch-lg ${name}`} />
                          <div className="theme-short-label">{name}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {activeView === 'dashboard' && (
            <div className="dash">
              {/* ── Welcome banner ─────────────────────────────────────── */}
              <section className="dash-welcome">
                <div className="dash-welcome-glow" />
                <div className="dash-welcome-text">
                  <div className="dash-welcome-eyebrow"><Icon.Sparkle /> Welcome back</div>
                  <h1>Hey {user?.full_name || 'there'}, ready to reconcile your data?</h1>
                  <p>
                    {dashboardStats.totalComparisons
                      ? `You have ${dashboardStats.totalComparisons} active comparison${dashboardStats.totalComparisons !== 1 ? 's' : ''} and ${dashboardStats.totalFiles} file${dashboardStats.totalFiles !== 1 ? 's' : ''} on record. Let's keep the momentum going.`
                      : 'Upload your first dataset to get AI-powered reconciliation, insights, and reports in seconds.'}
                  </p>
                  <div className="dash-welcome-actions">
                    <button type="button" className="dash-btn-primary" onClick={() => setActiveView('reconcile')}>
                      <Icon.Upload /> Start New Reconciliation
                    </button>
                    <button type="button" className="dash-btn-secondary" onClick={() => setActiveView('files')}>
                      <Icon.Files /> View Stored Files
                    </button>
                  </div>
                </div>
                <div className="dash-welcome-art" aria-hidden="true">
                  <svg viewBox="0 0 220 180" width="100%" height="100%">
                    <defs>
                      <linearGradient id="dashArtGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.9" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.9" />
                      </linearGradient>
                    </defs>
                    <rect x="18" y="30" width="80" height="100" rx="12" fill="url(#dashArtGrad)" opacity="0.18" />
                    <rect x="34" y="46" width="80" height="100" rx="12" fill="url(#dashArtGrad)" opacity="0.35" />
                    <rect x="50" y="62" width="80" height="100" rx="12" fill="url(#dashArtGrad)" opacity="0.65" />
                    <circle cx="176" cy="54" r="26" fill="url(#dashArtGrad)" opacity="0.8" />
                    <path d="M164 54l8 8 16-16" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </div>
              </section>

              {/* ── Summary cards ──────────────────────────────────────── */}
              <section className="dash-stats-grid">
                <div className="dash-stat-card accent-primary">
                  <div className="dash-stat-icon"><Icon.Layers /></div>
                  <div className="dash-stat-body">
                    <div className="dash-stat-value">{dashboardStats.totalFiles}</div>
                    <div className="dash-stat-label">Total Files Uploaded</div>
                  </div>
                </div>
                <div className="dash-stat-card accent-cyan">
                  <div className="dash-stat-icon"><Icon.Reconcile /></div>
                  <div className="dash-stat-body">
                    <div className="dash-stat-value">{dashboardStats.totalComparisons}</div>
                    <div className="dash-stat-label">Active Comparisons</div>
                  </div>
                </div>
                <div className="dash-stat-card accent-violet">
                  <div className="dash-stat-icon"><Icon.Doc /></div>
                  <div className="dash-stat-body">
                    <div className="dash-stat-value">{dashboardStats.totalReports}</div>
                    <div className="dash-stat-label">Saved Reports</div>
                  </div>
                </div>
                <div className="dash-stat-card accent-amber">
                  <div className="dash-stat-icon"><Icon.Trend /></div>
                  <div className="dash-stat-body">
                    <div className="dash-stat-value">{dashboardStats.thisWeekCount}</div>
                    <div className="dash-stat-label">Uploads This Week</div>
                  </div>
                </div>
              </section>

              {/* ── Recent activity + analytics ────────────────────────── */}
              <section className="dash-grid">
                <div className="dash-panel">
                  <div className="dash-panel-header">
                    <h2><Icon.Clock /> Recent Upload History</h2>
                    <button type="button" className="secondary" onClick={() => { fetchReports(); fetchSeriesList(); }}>↻ Refresh</button>
                  </div>

                  {!dashboardStats.recent.length && (
                    <p className="muted">No activity yet — upload a dataset from the Reconcile tab to get started.</p>
                  )}

                  <div className="dash-activity-list">
                    {dashboardStats.recent.map((item, i) => (
                      <div className="dash-activity-row" key={i}>
                        <span className="dash-activity-icon"><Icon.File /></span>
                        <div className="dash-activity-info">
                          <div className="dash-activity-name">{item.name}</div>
                          <div className="dash-activity-meta">{item.kind} · {formatUploadedAt(item.date)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dash-panel">
                  <div className="dash-panel-header">
                    <h2><Icon.Trend /> Files per Comparison</h2>
                  </div>

                  {!dashboardStats.topComparisons.length && (
                    <p className="muted">Analytics will appear here once you start reconciling datasets.</p>
                  )}

                  <div className="dash-bar-chart">
                    {dashboardStats.topComparisons.map((c, i) => (
                      <div className="dash-bar-row" key={i}>
                        <div className="dash-bar-label" title={c.name}>{c.name}</div>
                        <div className="dash-bar-track">
                          <div
                            className="dash-bar-fill"
                            style={{ width: `${Math.max(6, (c.count / dashboardStats.maxComparisonCount) * 100)}%` }}
                          />
                        </div>
                        <div className="dash-bar-value">{c.count}</div>
                      </div>
                    ))}
                  </div>

                  <div className="dash-mini-donut-row">
                    <svg viewBox="0 0 42 42" width="86" height="86" className="dash-donut">
                      {(() => {
                        const total = dashboardStats.totalComparisons + dashboardStats.totalReports || 1;
                        const compPct = (dashboardStats.totalComparisons / total) * 100;
                        return (
                          <>
                            <circle cx="21" cy="21" r="15.5" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                            <circle
                              cx="21" cy="21" r="15.5" fill="transparent"
                              stroke="var(--primary)" strokeWidth="6"
                              strokeDasharray={`${compPct} ${100 - compPct}`}
                              strokeDashoffset="25"
                              strokeLinecap="round"
                            />
                            <circle
                              cx="21" cy="21" r="15.5" fill="transparent"
                              stroke="var(--accent)" strokeWidth="6"
                              strokeDasharray={`${100 - compPct} ${compPct}`}
                              strokeDashoffset={`${25 - compPct}`}
                              strokeLinecap="round"
                            />
                          </>
                        );
                      })()}
                    </svg>
                    <div className="dash-mini-legend">
                      <div><span className="dot" style={{ background: 'var(--primary)' }} /> Comparisons ({dashboardStats.totalComparisons})</div>
                      <div><span className="dot" style={{ background: 'var(--accent)' }} /> Reports ({dashboardStats.totalReports})</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeView === 'reconcile' && (
            <>
              {/* ── Upload / control area (locked at top) ─────────────────── */}
              <section className="content-card">
                <div className="top-row">
                  <h1 style={{ margin: 0 }}>Reconcile Over Time</h1>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="series-select"
                      value={mode === 'new' ? '__new__' : (activeSeries?.series?.series_id || '__new__')}
                      onChange={(e) => (e.target.value === '__new__' ? startNew() : openSeries(e.target.value))}
                    >
                      <option value="__new__">➕ Start a new comparison…</option>
                      {seriesList.map((s) => (
                        <option key={s.series_id} value={s.series_id}>
                          {s.name} · {s.version_count} version{s.version_count !== 1 ? 's' : ''}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="secondary" onClick={fetchSeriesList}>↻</button>
                  </div>
                </div>

                <div className="reconcile-grid" ref={dropRef}>
                  <div className="reconcile-left">
                    {mode === 'new' ? (
                      <>
                        <div className="upload-hint">
                          Upload a baseline file to start a comparison, and optionally the next file right away to see your first diff immediately. Each file you add afterwards is reconciled against the previous one — like a running time series.
                        </div>
                        <div className="upload-row">
                          <input className="search-input" placeholder="Comparison name (optional)" value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} style={{ flex: 1 }} />
                        </div>
                      </>
                    ) : (
                      <div className="upload-hint">
                        Upload the next file for <strong>{activeSeries?.series?.name}</strong>. It will be reconciled against <strong>{latestLabel}</strong> (the latest version).
                      </div>
                    )}

                    <div className="upload-row">
                      <input ref={uploadInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => setUploadFile(e.target.files[0] || null)} />
                      <button type="button" className="file-input-label" onClick={() => uploadInputRef.current?.click()}>
                        {uploadFile ? `📄 ${uploadFile.name}` : (mode === 'new' ? 'Choose Baseline File' : 'Choose File to Compare')}
                      </button>
                      {uploadFile && <div className="selected-file"><strong>{uploadFile.name}</strong><span>{Math.round(uploadFile.size / 1024)} KB</span></div>}
                    </div>

                    {mode === 'new' && (
                      <div className="upload-row">
                        <input ref={uploadInputRef2} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => setUploadFile2(e.target.files[0] || null)} />
                        <button type="button" className="file-input-label" onClick={() => uploadInputRef2.current?.click()}>
                          {uploadFile2 ? `📄 ${uploadFile2.name}` : 'Choose File to Compare'}
                        </button>
                        {uploadFile2 && <div className="selected-file"><strong>{uploadFile2.name}</strong><span>{Math.round(uploadFile2.size / 1024)} KB</span></div>}
                      </div>
                    )}

                    {(mode === 'series' || (mode === 'new' && uploadFile2)) && (
                      <label>
                        Key column (optional)
                        <div className="upload-row">
                          <input className="search-input" placeholder="e.g. transaction_id or Project Name" value={uploadKeyCol} onChange={(e) => setUploadKeyCol(e.target.value)} style={{ flex: 1 }} />
                        </div>
                      </label>
                    )}
                  </div>

                  <aside className="action-frame">
                    {mode === 'new' ? (
                      <button type="button" className="run-btn" onClick={createSeries} disabled={seriesLoading || !uploadFile}>
                        {seriesLoading ? (uploadFile2 ? 'Comparing…' : 'Starting…') : (uploadFile2 ? 'Start & Compare' : 'Start Comparison')}
                      </button>
                    ) : (
                      <>
                        <button type="button" className="run-btn" onClick={addVersion} disabled={addingVersion || !uploadFile}>
                          {addingVersion ? 'Reconciling…' : 'Upload & Reconcile'}
                        </button>
                        <button type="button" className="secondary" onClick={() => deleteSeries(activeSeries.series.series_id, activeSeries.series.name)}>Delete Comparison</button>
                      </>
                    )}
                  </aside>
                </div>
                {error && <div className="error-banner">{error}</div>}
              </section>

              {/* ── Version timeline (navigation) ─────────────────────────── */}
              {mode === 'series' && activeSeries && (
                <section className="content-card">
                  <div className="top-row">
                    <h2 style={{ margin: 0 }}>Version Timeline</h2>
                    <span className="pill">{activeSeries.series.versions.length} version{activeSeries.series.versions.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="version-chip-row">
                    {activeSeries.timeline.map((v) => {
                      const isSource = v.version === 0;
                      const isSelected = selectedVersion === v.version;
                      const totalChanges = (v.added || 0) + (v.deleted || 0) + (v.updated || 0) + (v.renamed || 0);
                      return (
                        <button
                          key={v.version}
                          type="button"
                          className={`version-chip ${isSelected ? 'selected' : ''} ${isSource ? 'is-source' : ''}`}
                          onClick={() => selectVersion(v.version)}
                          disabled={isSource}
                          title={isSource ? 'Baseline — nothing to compare against' : `Compared against previous version`}
                        >
                          <span className={`ts-version-dot ${isSource ? 'dot-source' : totalChanges === 0 ? 'dot-clean' : 'dot-changes'}`} />
                          <span className="version-chip-label">{v.label}</span>
                          {!isSource && (
                            <span className="version-chip-badges">
                              <span className="status-badge status-added">+{v.added}</span>
                              <span className="status-badge status-deleted">−{v.deleted}</span>
                              <span className="status-badge status-updated">~{v.updated}</span>
                              {v.renamed > 0 && <span className="status-badge status-renamed">↷{v.renamed}</span>}
                            </span>
                          )}
                          {isSource && <span className="status-badge status-neutral">Baseline</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Results (full reconcile layout) ───────────────────────── */}
              {mode === 'series' && activeSeries && (
                seriesLoading ? (
                  <section className="content-card result-section"><p className="muted">Loading…</p></section>
                ) : selectedReport ? (
                  renderResults(selectedReport)
                ) : (
                  <section className="content-card result-section">
                    <h2>No comparison yet</h2>
                    <p className="muted">This comparison only has its baseline file so far. Upload the next file above and it will be reconciled against <strong>{latestLabel}</strong>.</p>
                  </section>
                )
              )}
            </>
          )}

          {activeView === 'files' && (
            <>
              <section className="content-card result-section">
                <div className="top-row">
                  <h2>Comparisons</h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="secondary" onClick={fetchSeriesList}>↻ Refresh</button>
                    <button type="button" className="danger" onClick={deleteAllSeries} disabled={!seriesList.length}>Delete All</button>
                  </div>
                </div>
                <p className="muted" style={{ marginTop: -6 }}>
                  Each comparison's baseline file is listed first — open it to see the target files that were compared against it, in the order they were added.
                </p>

                {!seriesList.length && <p className="muted">No comparisons yet. Start one from the Reconcile tab.</p>}

                <div className="stored-files-list">
                  {seriesList.map((s) => {
                    const isExpanded = expandedSeriesId === s.series_id;
                    const isLoadingDetail = seriesDetailLoading === s.series_id;
                    const targets = (seriesDetailCache[s.series_id] || []).filter((v) => v.version > 0);
                    return (
                      <Fragment key={s.series_id}>
                        <div className={`stored-file-row ${isExpanded ? 'active' : ''}`}>
                          <div className="stored-file-info" style={{ cursor: 'pointer' }} onClick={() => toggleSeriesExpand(s.series_id)}>
                            <span className="file-icon">{isExpanded ? '📂' : '📁'}</span>
                            <div>
                              <div className="file-name">
                                {s.baseline?.filename || s.name}
                                <span className="pill baseline-pill">Baseline</span>
                              </div>
                              <div className="file-meta">
                                {s.name} · uploaded {formatUploadedAt(s.baseline?.uploaded_at || s.created_at)} · {s.target_count} target file{s.target_count !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <div className="file-card-actions">
                            <button type="button" className="secondary" onClick={() => toggleSeriesExpand(s.series_id)}>
                              {isExpanded ? '▲ Hide Files' : '▼ Show Files'}
                            </button>
                            <button type="button" onClick={() => { openSeries(s.series_id); setActiveView('reconcile'); }}>Open in Reconcile</button>
                            <button type="button" className="danger" onClick={() => deleteSeries(s.series_id, s.name)}>Delete</button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="target-files-list">
                            {isLoadingDetail && <p className="muted">Loading files…</p>}
                            {!isLoadingDetail && !targets.length && (
                              <p className="muted">No target files added yet — upload one from the Reconcile tab to compare against this baseline.</p>
                            )}
                            {!isLoadingDetail && targets.map((v) => (
                              <div key={v.version} className="target-file-row">
                                <span className="file-icon">📄</span>
                                <div className="target-file-info">
                                  <div className="file-name">{v.filename}</div>
                                  <div className="file-meta">
                                    {v.label} · uploaded {formatUploadedAt(v.uploaded_at)}
                                    {v.diff_summary && (
                                      <> · +{v.diff_summary.added ?? 0} added, −{v.diff_summary.deleted ?? 0} deleted, {v.diff_summary.updated ?? 0} changed</>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={async () => { await openSeries(s.series_id); await selectVersion(v.version); setActiveView('reconcile'); }}
                                >
                                  View Diff
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {activeView === 'reports' && (
            <section className="content-card result-section">
              <div className="top-row">
                <h2>Saved Excel Reports</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="secondary" onClick={fetchReports}>↻ Refresh</button>
                  <button type="button" className="danger" onClick={deleteAllReports} disabled={!reports.length}>Delete All</button>
                </div>
              </div>
              <p className="muted" style={{ marginTop: -6 }}>
                Row-level discrepancies can be viewed here for whichever comparison is currently open on the Reconcile tab.
              </p>
              {!reports.length && <p className="muted">No reports saved yet. Run a reconciliation to generate one.</p>}
              <div className="reports-list">
                {reports.map((item) => {
                  const { label, timestamp } = formatReportName(item.filename);
                  const isLoadedInMemory = selectedReport?.reportFile === item.filename;
                  const isExpanded = expandedReportFile === item.filename;
                  return (
                    <div key={item.filename} className="report-row-wrap">
                      <div className="report-row">
                        <div className="report-info">
                          <span className="file-icon">📊</span>
                          <div>
                            <div className="file-name">{label}</div>
                            <div className="file-meta">{timestamp}</div>
                          </div>
                        </div>
                        <div className="file-card-actions">
                          {isLoadedInMemory && (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setExpandedReportFile(isExpanded ? null : item.filename)}
                            >
                              {isExpanded ? '▲ Hide Discrepancies' : '▼ View Discrepancies'}
                            </button>
                          )}
                          <button type="button" onClick={() => downloadReport(item.filename)}>⬇ Download</button>
                          <button type="button" className="danger" onClick={() => deleteReport(item.filename)}>Delete</button>
                        </div>
                      </div>
                      {isExpanded && isLoadedInMemory && (
                        <div className="report-row-discrepancies">
                          {renderDiscrepancies(selectedReport.report, selectedReport.beforeLabel, selectedReport.afterLabel)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>

      <div className="toasts">
        {toasts.map((toast) => <div key={toast.id} className="toast">{toast.message}</div>)}
      </div>

      <ChatWidget apiBase={API_BASE} seed={chatSeed} seriesList={seriesList} token={token} />
    </div>
  );
}

export default App;