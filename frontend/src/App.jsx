import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import axios from 'axios';
import ChatWidget from './ChatWidget';
import LandingPage from './LandingPage';
import { useAuth, authHeaders } from './AuthContext';
import AdminPanel from './AdminPanel';
import SchemaMappingModal from './SchemaMappingModal';

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
  AR: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 12h4M7 15h6M15 9l2 3-2 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
  const { user, token, isAdmin, logout, loading: authLoading } = useAuth();

  // ── General UI ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('dashboard');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);

  // ── Stored files & reports ───────────────────────────────────────────────
  const [reports, setReports] = useState([]);
  const [expandedReportFile, setExpandedReportFile] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({}); // Report section: which comparison "folder" is expanded

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

  // ── Live dashboard: KPI strip, day-by-day scoreboard, EDA report, comparison ─
  // Purely additive — reads the same series/version data already fetched above,
  // it doesn't change how comparisons are created, stored, or displayed elsewhere.
  const [clockNow, setClockNow] = useState(new Date());
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [versionProcessingMs, setVersionProcessingMs] = useState({}); // `${seriesId}:${version}` -> real measured ms
  const [edaDay, setEdaDay] = useState(null);                   // version number currently open in the EDA modal
  const [cmpFromDay, setCmpFromDay] = useState('');
  const [cmpToDay, setCmpToDay] = useState('');
  const [showCmpModal, setShowCmpModal] = useState(false);       // Day-by-Day Comparison — its own popup, opened via "View More"
  const [cardsPage, setCardsPage] = useState(0);                 // day-scoreboard pagination — 4 cards per page
  const CARDS_PER_PAGE = 4;

  const [newSeriesName, setNewSeriesName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadFile2, setUploadFile2] = useState(null);
  const [uploadKeyCol, setUploadKeyCol] = useState('');
  const [dataType, setDataType] = useState('auto'); // auto | master | transactional
  const [uploadColumns, setUploadColumns] = useState([]);   // columns from the uploaded file
  const [columnsLoading, setColumnsLoading] = useState(false);

  // ── Transaction Column Calculator ──────────────────────────────────────────
  const [calcSourceCol, setCalcSourceCol] = useState('');
  const [calcTargetCol, setCalcTargetCol] = useState('');
  const [calcResults, setCalcResults] = useState(null);   // { sumSource, sumTarget, difference }
  const [calcLoading, setCalcLoading] = useState(false);

  // ── Schema Mapping Modal state ───────────────────────────────────────────
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [schemaSourceCols, setSchemaSourceCols] = useState([]);
  const [schemaTargetCols, setSchemaTargetCols] = useState([]);
  const [pendingActionType, setPendingActionType] = useState('');
  const [uploadTargetColumns, setUploadTargetColumns] = useState([]);
  const [useDummyServer, setUseDummyServer] = useState(false);
  // Which target dataset to fetch (cjbs / etairos / airetech / ats -- see
  // backend/dummy_server/target_registry.py). Populated from
  // GET /api/dummy-integration/target-projects on mount.
  const [targetProjects, setTargetProjects] = useState([]);
  const [targetProject, setTargetProject] = useState('');

  const uploadInputRef = useRef(null);
  const uploadInputRef2 = useRef(null);
  const dropRef = useRef(null);

  // ── AR Reconciliation state (transactional files detected automatically) ──
  const [arResult, setArResult] = useState(null);       // full response from /api/ar/reconcile
  const [arRunning, setArRunning] = useState(false);
  const [arError, setArError] = useState('');
  const [arActiveTab, setArActiveTab] = useState('summary');
  const [arTolerance, setArTolerance] = useState('0.01');
  const [arFuzzyCutoff, setArFuzzyCutoff] = useState('0.72');
  const [srcDetection, setSrcDetection] = useState(null);
  const [tgtDetection, setTgtDetection] = useState(null);
  const [arOverrides, setArOverrides] = useState({ source: {}, target: {} });

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
      dataType: report.data_type || versions[idx]?.data_type || seriesData.data_type || 'master',
    };
  };

  // Turns one version's diff report into the KPI-style metrics used by the
  // live dashboard (KPI strip, day-by-day scoreboard, EDA report, comparison).
  // Same formulas already used on-screen elsewhere in this file (matched-rows
  // math from computeSummary, churn math from backend/insights.py), just
  // packaged as rates/scores instead of raw counts.
  const computeRunMetrics = (report) => {
    if (!report) return null;
    const sourceCount = report.source_record_count || 0;
    const targetCount = report.target_record_count || 0;
    const updated = report.mismatches?.count || 0;
    const inserted = report.missing_in_source?.count || 0;   // new in target
    const missing = report.missing_in_target?.count || 0;    // gone from target
    const renamed = report.fuzzy_matches?.count || 0;
    const formatIssues = report.format_inconsistencies?.count || 0;
    const duplicates = (report.duplicates_source?.count || 0) + (report.duplicates_target?.count || 0);
    const total = Math.max(sourceCount, targetCount);
    const matched = Math.max(total - updated - inserted - missing - renamed - formatIssues, 0);
    const matchRate = total ? (matched / total) * 100 : 0;
    const duplicateRate = targetCount ? (duplicates / targetCount) * 100 : 0;
    const missingRate = total ? (missing / total) * 100 : 0;
    const qualityScore = Math.max(0, Math.min(100, matchRate - duplicateRate * 0.5 - missingRate * 0.3));
    return { total, matched, updated, inserted, missing, duplicates, matchRate, duplicateRate, missingRate, qualityScore };
  };

  // ── AR helpers ──────────────────────────────────────────────────────────
  const detectFileType = async (file) => {
    if (!file) return null;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await axios.post(`${API_BASE}/api/ar/detect-type`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      return res.data;
    } catch { return null; }
  };

  const runArReconcile = async (srcFile, tgtFile) => {
    if (!srcFile || !tgtFile) { showToast('Please pick both Source and Target files.'); return; }
    setArRunning(true);
    setArError('');
    setArResult(null);
    const fd = new FormData();
    fd.append('source_file', srcFile);
    fd.append('target_file', tgtFile);
    fd.append('tolerance', arTolerance);
    fd.append('fuzzy_cutoff', arFuzzyCutoff);
    Object.entries(arOverrides.source).forEach(([k, v]) => fd.append(`src_override_${k}`, v));
    Object.entries(arOverrides.target).forEach(([k, v]) => fd.append(`tgt_override_${k}`, v));
    try {
      const res = await axios.post(`${API_BASE}/api/ar/reconcile`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      setArResult(res.data);
      setArActiveTab('summary');
      showToast('AR reconciliation complete');
    } catch (err) {
      setArError(err.response?.data?.error || 'AR reconciliation failed.');
    } finally {
      setArRunning(false);
    }
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

  // Populates the "Target dataset" picker shown when "Fetch Target
  // automatically from Dummy Server" is checked -- lists every project the
  // Dummy Server can serve (CJBS, Etairos, Airetech, ATS, ...; see
  // backend/dummy_server/target_registry.py) instead of silently always
  // comparing against CJBS.
  const fetchTargetProjects = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/dummy-integration/target-projects`, { headers: authHeaders(token) });
      const projects = res.data.projects || [];
      setTargetProjects(projects);
      if (!targetProject && projects.length) {
        setTargetProject(res.data.default_project || projects[0].project_name);
      }
    } catch { /* silent -- the picker just won't populate; autoReconcile still works with the default target */ }
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

  // Fetch column names from the uploaded file so the user can pick the key from a dropdown.
  const fetchColumns = async (file) => {
    if (!file) { setUploadColumns([]); setUploadKeyCol(''); return; }
    setColumnsLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post(`${API_BASE}/api/preview-columns`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      setUploadColumns(res.data.columns || []);
      setUploadKeyCol(res.data.suggested_key || '');
    } catch {
      setUploadColumns([]);
      setUploadKeyCol('');
    } finally {
      setColumnsLoading(false);
    }
  };

  // ── Reads the uploaded file and computes column sums for the calculator ────
  const parseFileRows = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result || '';
        const lines = text.split(/\r\n|\n/).filter(Boolean);
        if (lines.length < 2) { resolve([]); return; }
        const headers = lines[0].split(/,|\t/).map((h) => h.replace(/^"|"$/g, '').trim());
        const rows = lines.slice(1).map((line) => {
          const vals = line.split(/,|\t/).map((v) => v.replace(/^"|"$/g, '').trim());
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
        resolve(rows);
      } catch { resolve([]); }
    };
    reader.readAsText(file);
  });

  const calculateColumnSums = async (overrideSrc, overrideTgt) => {
    if (!uploadFile) { showToast('Please upload a file first.'); return; }
    const srcCol = overrideSrc !== undefined ? overrideSrc : calcSourceCol;
    const tgtCol = overrideTgt !== undefined ? overrideTgt : calcTargetCol;
    if (!srcCol && !tgtCol) { showToast('Please select at least one column.'); return; }
    setCalcLoading(true);
    try {
      const rows = await parseFileRows(uploadFile);
      const toNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
      const sumSource = srcCol ? rows.reduce((acc, r) => acc + toNum(r[srcCol]), 0) : null;
      const sumTarget = tgtCol ? rows.reduce((acc, r) => acc + toNum(r[tgtCol]), 0) : null;
      const difference = sumSource !== null && sumTarget !== null ? sumSource - sumTarget : null;
      setCalcResults({ sumSource, sumTarget, difference, rowCount: rows.length });
    } catch (err) {
      showToast('Could not calculate — please make sure the file is a valid CSV.');
    } finally {
      setCalcLoading(false);
    }
  };

  const parseFileHeaders = async (file) => {
    if (!file) return [];
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post(`${API_BASE}/api/parse-columns`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      if (res.data?.columns?.length) return res.data.columns;
    } catch (err) {
      console.warn('Backend parse-columns failed:', err);
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result || '';
          const firstLine = text.split(/\r\n|\n/)[0];
          if (firstLine && !firstLine.startsWith('PK')) {
            const cols = firstLine.split(/,|\t/).map((c) => c.replace(/^"|"$/g, '').trim()).filter(Boolean);
            resolve(cols);
            return;
          }
        } catch (err) {}
        resolve([]);
      };
      reader.readAsText(file.slice(0, 1024 * 10));
    });
  };

  const getPreviousVersionColumns = () => {
    if (!selectedReport?.report) return [];
    const report = selectedReport.report;
    const sample = (report.full_comparison?.rows || [])[0] ||
                   (report.mismatches?.rows || [])[0] ||
                   (report.missing_in_target?.rows || [])[0] ||
                   (report.only_source_rows || [])[0] ||
                   (report.matched_rows || [])[0];
    if (sample) {
      const srcObj = sample.source_row || sample;
      return Object.keys(srcObj).filter((c) => c !== '_reconciliation_key' && !c.endsWith('_Source') && !c.endsWith('_Target'));
    }
    return [];
  };

  const triggerSchemaModal = async (actionType) => {
    if (!uploadFile) {
      showToast('Please select a file first.');
      return;
    }
    setPendingActionType(actionType);

    let srcCols = [];
    let tgtCols = [];

    if (actionType === 'add_version' || mode === 'series') {
      const prevCols = getPreviousVersionColumns();
      srcCols = prevCols.length ? prevCols : (uploadColumns.length ? uploadColumns : await parseFileHeaders(uploadFile));
      tgtCols = uploadColumns.length ? uploadColumns : await parseFileHeaders(uploadFile);
    } else {
      srcCols = uploadColumns.length ? uploadColumns : await parseFileHeaders(uploadFile);
      if (!useDummyServer && uploadFile2) {
        tgtCols = uploadTargetColumns.length ? uploadTargetColumns : await parseFileHeaders(uploadFile2);
      } else if (useDummyServer || actionType === 'new_dummy') {
        try {
          const proj = targetProject || 'cjbs';
          const res = await axios.get(`${API_BASE}/api/dummy-integration/target-schema?project_name=${proj}`, {
            headers: authHeaders(token),
          });
          tgtCols = res.data?.columns || [];
        } catch (err) {
          tgtCols = [];
          showToast('Could not load the Target schema from the Dummy Server. Check that the Dummy Server is running.');
        }
      } else if (uploadTargetColumns.length) {
        tgtCols = uploadTargetColumns;
      }
    }

    setSchemaSourceCols(srcCols);
    setSchemaTargetCols(tgtCols.length ? tgtCols : srcCols);
    setShowSchemaModal(true);
  };

  const handleConfirmReconcileModal = async (srcKey, tgtKey, columnMap, amtSrcCol, amtTgtCol) => {
    setShowSchemaModal(false);
    const chosenKey = srcKey || uploadKeyCol;
    setUploadKeyCol(chosenKey);

    const updatedColumnMap = { ...(columnMap || {}) };
    if (amtSrcCol) {
      setCalcSourceCol(amtSrcCol);
      updatedColumnMap.__amount_source_col__ = amtSrcCol;
    }
    if (amtTgtCol) {
      setCalcTargetCol(amtTgtCol);
      updatedColumnMap.__amount_target_col__ = amtTgtCol;
    }

    if (pendingActionType === 'new_dummy') {
      await autoReconcileWithKey(chosenKey, updatedColumnMap);
    } else if (pendingActionType === 'new_manual') {
      await createSeriesWithKey(chosenKey, updatedColumnMap);
    } else if (pendingActionType === 'add_version') {
      await addVersionWithKey(chosenKey, updatedColumnMap);
    }

    if (uploadFile && (amtSrcCol || amtTgtCol)) {
      calculateColumnSums(amtSrcCol || calcSourceCol, amtTgtCol || calcTargetCol);
    }
  };

  const createSeriesWithKey = async (overrideKey, columnMap) => {
    if (!uploadFile) { showToast('Please pick a baseline file first.'); return; }
    const keyToUse = overrideKey || uploadKeyCol;
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (newSeriesName.trim()) fd.append('name', newSeriesName.trim());
    fd.append('data_type', dataType);
    if (columnMap && Object.keys(columnMap).length) fd.append('schema_mapping', JSON.stringify(columnMap));
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
        if (keyToUse.trim()) fd2.append('key_columns', keyToUse.trim());
        fd2.append('data_type', dataType);
        if (columnMap && Object.keys(columnMap).length) fd2.append('schema_mapping', JSON.stringify(columnMap));
        try {
          await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd2, {
            headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
          });
        } catch (err) {
          showToast(err.response?.data?.error || 'Baseline created, but the second file could not be compared.');
        }
      }
      await fetchSeriesList();
      showToast(uploadFile2 ? `Series "${res.data.series.name}" created — first comparison ready` : `Series "${res.data.series.name}" created — upload the next file to compare`);
      await openSeries(seriesId);
      await fetchReports();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create series.');
    } finally {
      setSeriesLoading(false);
    }
  };

  const autoReconcileWithKey = async (overrideKey, columnMap) => {
    if (!uploadFile) { showToast('Please pick a Source file first.'); return; }
    const keyToUse = overrideKey || uploadKeyCol;
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (newSeriesName.trim()) fd.append('name', newSeriesName.trim());
    if (keyToUse.trim()) fd.append('key_columns', keyToUse.trim());
    fd.append('data_type', dataType);
    if (targetProject) fd.append('project_name', targetProject);
    if (columnMap && Object.keys(columnMap).length) fd.append('schema_mapping', JSON.stringify(columnMap));
    try {
      setSeriesLoading(true);
      setError('');
      const res = await axios.post(`${API_BASE}/api/dummy-integration/auto-reconcile`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      showToast(`Target data fetched from Dummy Server — comparison ready (${res.data.dummy_server_records_fetched} target record(s))`);
      await Promise.all([openSeries(res.data.series_id), fetchSeriesList(), fetchReports()]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not auto-reconcile against the Dummy Server.');
    } finally {
      setSeriesLoading(false);
    }
  };

  const addVersionWithKey = async (overrideKey, columnMap) => {
    if (!uploadFile) { showToast('Please pick a file to compare first.'); return; }
    const keyToUse = overrideKey || uploadKeyCol;
    const seriesId = activeSeries.series.series_id;
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (keyToUse.trim()) fd.append('key_columns', keyToUse.trim());
    fd.append('data_type', dataType);
    if (columnMap && Object.keys(columnMap).length) fd.append('schema_mapping', JSON.stringify(columnMap));
    try {
      setAddingVersion(true);
      setError('');
      const startedAt = performance.now();
      const addRes = await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      const elapsedMs = performance.now() - startedAt;
      const newVersion = addRes.data?.version?.version;
      if (newVersion != null) setVersionProcessingMs((prev) => ({ ...prev, [`${seriesId}:${newVersion}`]: elapsedMs }));
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
    setUploadColumns([]);
    setDataType('auto');
    setNewSeriesName('');
    setUseDummyServer(false);
    setError('');
  };

  const openSeries = async (seriesId) => {
    setSeriesLoading(true);
    setError('');
    setVersionReports({});
    setUploadFile(null);
    setUploadFile2(null);
    setUploadKeyCol('');
    setUploadColumns([]);
    try {
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`, { headers: authHeaders(token) });
      const seriesData = res.data.series;
      setDataType(seriesData.data_type || 'master');
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
    fd.append('data_type', dataType);
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
        fd2.append('data_type', dataType);
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

  // Dummy Server integration: uploads ONLY the Source file to the new
  // backend endpoint (/api/dummy-integration/auto-reconcile). The backend
  // detects the business key, fetches Target data from the Dummy Server,
  // and runs it through the SAME comparison engine as createSeries()/
  // addVersion() above — this function does not touch or duplicate any
  // comparison logic, it just calls a different upload endpoint and then
  // reuses the existing openSeries()/fetchSeriesList()/fetchReports()
  // helpers to show the result.
  const autoReconcile = async () => {
    if (!uploadFile) { showToast('Please pick a Source file first.'); return; }
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (newSeriesName.trim()) fd.append('name', newSeriesName.trim());
    if (uploadKeyCol.trim()) fd.append('key_columns', uploadKeyCol.trim());
    fd.append('data_type', dataType);
    // Which target dataset to fetch from the Dummy Server (cjbs / etairos /
    // airetech / ats). Without this the backend defaults to "default_project",
    // which the Dummy Server resolves to CJBS regardless of what op-co you
    // actually meant to compare against.
    if (targetProject) fd.append('project_name', targetProject);
    try {
      setSeriesLoading(true);
      setError('');
      const res = await axios.post(`${API_BASE}/api/dummy-integration/auto-reconcile`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      await fetchSeriesList();
      showToast(`Target data fetched from Dummy Server — comparison ready (${res.data.dummy_server_records_fetched} target record(s))`);
      await openSeries(res.data.series_id);
      await fetchReports();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not auto-reconcile against the Dummy Server.');
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
    fd.append('data_type', dataType);
    try {
      setAddingVersion(true);
      setError('');
      const startedAt = performance.now();
      const addRes = await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data', ...authHeaders(token) },
      });
      const elapsedMs = performance.now() - startedAt;
      const newVersion = addRes.data?.version?.version;
      if (newVersion != null) {
        setVersionProcessingMs((prev) => ({ ...prev, [`${seriesId}:${newVersion}`]: elapsedMs }));
      }
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
    
    // Pattern 1: timestamp at the beginning (e.g. 20260718T160202Z_filename)
    let tsMatch = base.match(/^(\d{8}T\d{6}Z)_(.+)$/);
    if (tsMatch) {
      const ts = tsMatch[1];
      const rest = tsMatch[2].replace(/_vs_/g, ' vs ').replace(/_xlsx/g, '.xlsx').replace(/_/g, ' ');
      const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)} UTC`;
      return { label: rest, timestamp: date };
    }
    
    // Pattern 2: timestamp at the end (e.g. filename_20260718T160202Z)
    tsMatch = base.match(/^(.+)_(\d{8}T\d{6}Z)$/);
    if (tsMatch) {
      const rest = tsMatch[1].replace(/_vs_/g, ' vs ').replace(/_xlsx/g, '.xlsx').replace(/_/g, ' ');
      const ts = tsMatch[2];
      const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)} UTC`;
      return { label: rest, timestamp: date };
    }
    
    return { label: filename, timestamp: '' };
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
    fetchReports().catch(() => { });
    fetchSeriesList().catch(() => { });
    fetchTargetProjects().catch(() => { });
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

  // Live clock for the KPI strip — ticks every second off the real system
  // clock (not simulated), same idea as the clock in the standalone Ledger
  // mock this dashboard is modeled on.
  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Always surface the page containing the newest day — mirrors the Ledger
  // mock's "always jump to the group with the newest run" behavior.
  useEffect(() => {
    const versions = (activeSeries?.series?.versions || []).filter((v) => v.version > 0);
    const lastPage = versions.length ? Math.max(0, Math.ceil(versions.length / CARDS_PER_PAGE) - 1) : 0;
    setCardsPage(lastPage);
  }, [activeSeries?.series?.series_id, activeSeries?.series?.versions?.length]);

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') setEdaDay(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Prefetches every version's diff report for the currently open series so
  // the KPI strip / day-by-day scoreboard / comparison panel below have real
  // numbers for every day, not just whichever version happens to be selected.
  // Reuses the same versionReports cache + buildPayload() that selectVersion()
  // already populates — this just fills in the rest in the background.
  useEffect(() => {
    if (mode !== 'series' || !activeSeries) return undefined;
    const seriesId = activeSeries.series.series_id;
    const seriesData = activeSeries.series;
    const versions = (seriesData.versions || []).filter((v) => v.version > 0);
    const missing = versions.filter((v) => !versionReports[v.version]);
    if (!missing.length) return undefined;
    let cancelled = false;
    setMetricsLoading(true);
    Promise.all(missing.map((v) =>
      axios.get(`${API_BASE}/api/series/${seriesId}/versions/${v.version}/report`, { headers: authHeaders(token) })
        .then((res) => ({ version: v.version, payload: buildPayload(seriesData, v.version, res.data.report) }))
        .catch(() => null)
    )).then((results) => {
      if (cancelled) return;
      setVersionReports((prev) => {
        const next = { ...prev };
        results.forEach((r) => { if (r) next[r.version] = r.payload; });
        return next;
      });
      setMetricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, activeSeries]);

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

  // Smooth curved (catmull-rom → bezier) area/line chart for the Day-by-Day
  // Comparison popup — one soft-gradient curve per category (Matched ·
  // Mismatched · Other/New), glowing points at each day. Hovering shows a
  // live tooltip; clicking a point PINS that tooltip open (it stops
  // following the cursor and stays put) until the same point is clicked
  // again or the user clicks anywhere outside the chart.
  const ComparisonRangeChart = ({ list }) => {
    const width = 760, height = 320;
    const wrapRef = useRef(null);
    const [hovered, setHovered] = useState(null);
    const [pinned, setPinned] = useState(null);
    const gid = useRef(`cmp${Math.random().toString(36).slice(2, 9)}`);

    const categories = [
      { key: 'matched', label: 'Matched', color: '#2dd4bf' },
      { key: 'mismatched', label: 'Mismatched', color: '#f2545b' },
      { key: 'other', label: 'Other (New Records)', color: '#60a5fa' },
    ];

    const groups = list.map((d) => ({
      version: d.version,
      matched: d.metrics.matched,
      mismatched: d.metrics.updated + d.metrics.missing + d.metrics.duplicates,
      other: d.metrics.inserted,
      updated: d.metrics.updated,
      missing: d.metrics.missing,
      duplicates: d.metrics.duplicates,
    }));
    const n = groups.length;
    const maxVal = Math.max(1, ...groups.flatMap((g) => categories.map((c) => g[c.key])));

    const margin = { top: 20, right: 26, bottom: 40, left: 46 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const yBase = margin.top + plotH;
    const yAt = (v) => yBase - (v / maxVal) * plotH;
    const xAt = (i) => (n === 1 ? margin.left + plotW / 2 : margin.left + (i / (n - 1)) * plotW);
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f));

    // Catmull-Rom → cubic-bezier smoothing, so each curve bends gently
    // through every day's point instead of joining them with straight edges.
    const smoothLine = (pts) => {
      if (pts.length < 2) return pts.length ? `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}` : '';
      let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
      }
      return d;
    };

    const curves = categories.map((c) => {
      const pts = groups.map((g, i) => [xAt(i), yAt(g[c.key])]);
      const line = smoothLine(pts);
      const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(2)},${yBase} L${pts[0][0].toFixed(2)},${yBase} Z` : '';
      return { ...c, pts, line, area };
    });

    // Shared helper: given a client X, find the nearest day and the tooltip
    // position for it (in wrap-relative pixels).
    const locate = (evt) => {
      const box = evt.currentTarget.getBoundingClientRect(); // maps the full viewBox (0..width, 0..height)
      const scaleX = box.width / width;
      const scaleY = box.height / height;
      const rawX = (evt.clientX - box.left) / scaleX;
      const relX = Math.min(Math.max(rawX, margin.left), width - margin.right);
      let closest = 0;
      let bestDist = Infinity;
      groups.forEach((_, i) => {
        const dist = Math.abs(xAt(i) - relX);
        if (dist < bestDist) { bestDist = dist; closest = i; }
      });
      const topY = Math.min(...categories.map((c) => yAt(groups[closest][c.key])));
      const wrapBox = wrapRef.current.getBoundingClientRect();
      return {
        index: closest,
        x: box.left - wrapBox.left + xAt(closest) * scaleX,
        y: box.top - wrapBox.top + topY * scaleY,
      };
    };

    // Hover tracking lives on the whole SVG (not a narrow inner rect), so
    // gliding over a dot, a curve, or the margins never counts as "leaving".
    const handleMove = (evt) => setHovered(locate(evt));
    const handleClick = (evt) => {
      const loc = locate(evt);
      setPinned((prev) => (prev && prev.index === loc.index ? null : loc));
    };

    // Clicking anywhere outside the chart un-pins the tooltip.
    useEffect(() => {
      if (!pinned) return undefined;
      const onDocPointerDown = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setPinned(null);
      };
      document.addEventListener('mousedown', onDocPointerDown);
      return () => document.removeEventListener('mousedown', onDocPointerDown);
    }, [pinned]);

    const active = pinned || hovered;

    return (
      <div className="timeline-chart-wrap cmp-curve-wrap" ref={wrapRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="timeline-chart-svg"
          style={{ cursor: 'pointer' }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
          onClick={handleClick}
        >
          <defs>
            {curves.map((c) => (
              <linearGradient key={c.key} id={`${gid.current}-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.color} stopOpacity="0.38" />
                <stop offset="100%" stopColor={c.color} stopOpacity="0" />
              </linearGradient>
            ))}
            <filter id={`${gid.current}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g style={{ pointerEvents: 'none' }}>
            {gridLines.map((v, i) => (
              <g key={i}>
                <line x1={margin.left} x2={width - margin.right} y1={yAt(v)} y2={yAt(v)} stroke="var(--card-border)" strokeWidth="1" strokeDasharray="3,4" />
                <text x={margin.left - 8} y={yAt(v)} textAnchor="end" dominantBaseline="middle" className="timeline-axis-label">{v}</text>
              </g>
            ))}

            {curves.map((c) => (
              <path key={`${c.key}-area`} d={c.area} fill={`url(#${gid.current}-${c.key})`} stroke="none" />
            ))}
            {curves.map((c) => (
              <path key={`${c.key}-line`} d={c.line} fill="none" stroke={c.color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gid.current}-glow)`} />
            ))}
            {curves.map((c) => (
              <g key={`${c.key}-dots`}>
                {c.pts.map(([px, py], i) => (
                  <circle
                    key={i}
                    cx={px} cy={py}
                    r={active?.index === i ? 5 : 3.2}
                    fill="var(--panel, #0f172a)"
                    stroke={c.color}
                    strokeWidth={active?.index === i ? 2.6 : 2}
                    style={{ transition: 'r 0.12s ease' }}
                  />
                ))}
              </g>
            ))}

            {active != null && (
              <line x1={xAt(active.index)} x2={xAt(active.index)} y1={margin.top} y2={yBase} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2,3" opacity="0.5" />
            )}

            {groups.map((g, i) => (
              <text key={g.version} x={xAt(i)} y={height - margin.bottom + 18} textAnchor="middle" className="timeline-axis-label">Day {g.version}</text>
            ))}
          </g>
        </svg>

        {active != null && (() => {
          const g = groups[active.index];
          return (
            <div className="timeline-tooltip" style={{ left: active.x, top: active.y }}>
              <div className="timeline-tooltip-date">
                Day {g.version}
                {pinned && <span className="cmp-tooltip-pinned"> · pinned, click again to close</span>}
              </div>
              {categories.map((c) => (
                <div key={c.key} className="timeline-tooltip-row">
                  <span className="pie-swatch" style={{ background: c.color }} />
                  <span className="timeline-tooltip-label">{c.label}</span>
                  <strong>{g[c.key].toLocaleString('en-US')}</strong>
                </div>
              ))}
              <div className="timeline-tooltip-row timeline-tooltip-total">
                <span className="muted" style={{ fontSize: 11 }}>Updated {g.updated} · Missing {g.missing} · Duplicate {g.duplicates}</span>
              </div>
            </div>
          );
        })()}

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

  const renderValueHistory = () => (
    <section className="content-card result-section">
      <div className="top-row">
        <h2>Value History Over Time <span className="muted" style={{ fontWeight: 600 }}>— baseline stored in Postgres</span></h2>
        {historyStatus === 'ready' && <span className="pill">{valueHistory?.entries?.length || 0} changed values</span>}
      </div>
      {historyStatus === 'loading' && <p className="muted">Loading history…</p>}
      {historyStatus === 'unavailable' && <p className="muted">Day-over-day value history needs the Postgres <code>db</code> service running.</p>}
      {historyStatus === 'ready' && (!valueHistory?.entries?.length ? <p className="muted">No changed values tracked yet — this fills in as more days get compared.</p> : (
        <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Key</th><th>Column</th>{valueHistory.versions.map((v) => <th key={v.version}>{v.label || `Day ${v.version}`}</th>)}</tr></thead><tbody>
          {valueHistory.entries.map((entry, i) => <tr key={`${entry.row_key}-${entry.column}-${i}`}><td>{entry.row_key}</td><td>{entry.column}</td>{valueHistory.versions.map((v) => {
            const val = entry.values[String(v.version)];
            const previous = valueHistory.versions[valueHistory.versions.findIndex((vv) => vv.version === v.version) - 1];
            const changed = previous && val !== undefined && entry.values[String(previous.version)] !== undefined && val !== entry.values[String(previous.version)];
            return <td key={v.version} className={changed ? 'history-cell-changed' : undefined}>{(val === undefined || val === null || String(val).trim() === '') ? <span className="muted">—</span> : val}</td>;
          })}</tr>)}
        </tbody></table></div>
      ))}
    </section>
  );

  const renderMetadataAndChanges = (payload) => {
    const { report, beforeLabel, afterLabel, keyColumns, dataType } = payload;
    const versions = activeSeries?.series?.versions || [];
    const currentVersion = versions.find((item) => item.version === payload.version);
    
    return (
      <section className="content-card result-section">
        <div className="top-row">
          <h2>Metadata, Key Mapping & Day-wise Changes</h2>
          <span className={`pill ${dataType === 'transactional' ? 'data-type-transactional' : 'data-type-master'}`}>
            {dataType === 'transactional' ? 'Transactional Data' : 'Master Data'}
          </span>
        </div>
        <div className="history-table-wrap">
          <table className="history-table metadata-table">
            <thead><tr><th>Metadata</th><th>Value</th><th>Mapped To</th></tr></thead>
            <tbody>
              <tr><td>Comparison</td><td>{activeSeries?.series?.name || 'Current comparison'}</td><td>{beforeLabel} → {afterLabel}</td></tr>
              <tr><td>Primary key column(s)</td><td>{keyColumns?.join(', ') || 'Auto-detected'}</td><td>{keyColumns?.join(', ') || 'Auto-detected'}</td></tr>
              <tr><td>Source file</td><td>{versions.find((item) => item.label === beforeLabel)?.filename || beforeLabel}</td><td>{beforeLabel}</td></tr>
              <tr><td>Target file</td><td>{currentVersion?.filename || afterLabel}</td><td>{afterLabel}</td></tr>
              <tr><td>Records</td><td>{report.source_record_count ?? 0} source</td><td>{report.target_record_count ?? 0} target</td></tr>
            </tbody>
          </table>
        </div>

      </section>
    );
  };

  // ── Full reconcile-style results block for one version diff ────────────────
  const renderResults = (payload) => {
    const { report, day_summary, insights, beforeLabel, afterLabel, reportFile, keyColumns, version, dataType: reportDataType } = payload;
    return (
      <>
        {renderMetadataAndChanges(payload)}
        {renderValueHistory()}
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
                { label: 'Only in Source (Deleted)', value: day_summary.reduce((sum, d) => sum + (d.missing_in_target || 0), 0), color: '#ef4444' },
                { label: 'Only in Target (Added)', value: day_summary.reduce((sum, d) => sum + (d.missing_in_source || 0), 0), color: '#22c55e' },
                { label: 'Duplicates', value: day_summary.reduce((sum, d) => sum + (d.duplicates_source || 0) + (d.duplicates_target || 0), 0), color: '#f59e0b' },
                { label: 'Value Changes', value: day_summary.reduce((sum, d) => sum + (d.mismatches || 0), 0), color: '#3b82f6' },
                { label: 'Format Issues', value: day_summary.reduce((sum, d) => sum + (d.format_inconsistencies || 0), 0), color: '#a855f7' },
              ]} />
            </div>
          ) : <p className="muted">No shared date column was found, so day-wise grouping was skipped.</p>}
        </section>

        {report && renderDiscrepancies(report, beforeLabel, afterLabel)}
      </>
    );
  };

  // ── Discrepancies detail ──────────────────────────────────────────────────
  const renderDiscrepancies = (report, beforeLabel, afterLabel) => (
    <section className="content-card result-section" style={{ marginTop: 20 }}>
      <div className="top-row">
        <h2>Discrepancies Breakdown</h2>
      </div>
      <p className="muted" style={{ margin: '-4px 0 16px 0', fontSize: '0.85rem' }}>
        Detailed breakdown of matched, missing, and modified transactions between <strong>{beforeLabel}</strong> and <strong>{afterLabel}</strong>.
      </p>

      {/* Explanatory Cards for Only in Source & Only in Target */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div className="card" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.06)', padding: '16px 18px', borderRadius: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#ef4444', fontWeight: 700 }}>🔴 Only in Source ({report.missing_in_target?.count || 0})</h3>
            <span className="pill" style={{ background: 'rgba(239, 68, 68, 0.18)', color: '#ef4444', fontSize: '0.72rem', fontWeight: 700 }}>Deleted / Missing</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.45 }}>
            A transaction exists in <strong>{beforeLabel}</strong> but was never recorded (or was deleted) in <strong>{afterLabel}</strong>.
          </p>
        </div>

        <div className="card" style={{ borderColor: 'rgba(34, 197, 94, 0.4)', background: 'rgba(34, 197, 94, 0.06)', padding: '16px 18px', borderRadius: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#22c55e', fontWeight: 700 }}>🟢 Only in Target ({report.missing_in_source?.count || 0})</h3>
            <span className="pill" style={{ background: 'rgba(34, 197, 94, 0.18)', color: '#22c55e', fontSize: '0.72rem', fontWeight: 700 }}>Added / New</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.45 }}>
            A transaction exists in <strong>{afterLabel}</strong> but was never recorded (or was added new) in <strong>{beforeLabel}</strong>.
          </p>
        </div>
      </div>

      <details open><summary>All rows, side by side ({report.full_comparison?.count || 0})</summary>{renderFullComparison(report.full_comparison?.rows, beforeLabel, afterLabel)}</details>
      <details open><summary>🔴 Only in Source — missing from {afterLabel} ({report.missing_in_target?.count || 0})</summary>{renderRows(report.missing_in_target?.rows, 'Only in Source (Deleted)')}</details>
      <details open><summary>🟢 Only in Target — missing from {beforeLabel} ({report.missing_in_source?.count || 0})</summary>{renderRows(report.missing_in_source?.rows, 'Only in Target (Added)')}</details>
      <details><summary>Value changes ({report.mismatches?.count || 0})</summary>{renderIssueRows(report.mismatches?.rows, beforeLabel, afterLabel)}</details>
      <details><summary>{beforeLabel} duplicates ({report.duplicates_source?.count || 0})</summary>{renderRows(report.duplicates_source?.rows)}</details>
      <details><summary>{afterLabel} duplicates ({report.duplicates_target?.count || 0})</summary>{renderRows(report.duplicates_target?.rows)}</details>
      <details><summary>Renamed — fuzzy-matched keys ({report.fuzzy_matches?.count || 0})</summary>{renderFuzzyRows(report.fuzzy_matches?.rows, beforeLabel, afterLabel)}</details>
      <details><summary>Format inconsistencies ({report.format_inconsistencies?.count || 0})</summary>{renderIssueRows(report.format_inconsistencies?.rows, beforeLabel, afterLabel)}</details>
    </section>
  );

  const latestLabel = activeSeries?.series?.versions?.slice(-1)[0]?.label;

  // ── Live dashboard derived data — shared by the KPI strip, the paginated  ──
  // day cards, the EDA modal trigger, and the day-by-day comparison panel.
  // Recomputed each render from activeSeries/versionReports; cheap given the
  // typical number of days in a student/portfolio-scale series.
  const dashSeriesId = activeSeries?.series?.series_id || null;
  const dashAllVersions = activeSeries?.series?.versions || [];
  const dashDayVersions = dashAllVersions.filter((v) => v.version > 0);
  const dashDayRows = dashDayVersions.map((v) => {
    const payload = versionReports[v.version];
    const metrics = payload ? computeRunMetrics(payload.report) : null;
    const procMs = dashSeriesId ? versionProcessingMs[`${dashSeriesId}:${v.version}`] : undefined;
    return {
      version: v.version,
      label: v.label,
      uploadedAt: v.uploaded_at,
      sourceLabel: payload?.beforeLabel,
      targetLabel: payload?.afterLabel,
      metrics,
      procMs,
    };
  });
  const dashWithMetrics = dashDayRows.filter((d) => d.metrics);
  const dashNextDay = dashAllVersions.length; // next upload becomes this day number
  const dashTotalRuns = dashDayVersions.length;
  const dashRecordsAllTime = dashWithMetrics.reduce((sum, d) => sum + d.metrics.total, 0);
  const dashAvgMatchRate = dashWithMetrics.length
    ? dashWithMetrics.reduce((sum, d) => sum + d.metrics.matchRate, 0) / dashWithMetrics.length
    : null;
  const dashLastDay = dashWithMetrics[dashWithMetrics.length - 1];
  const dashPrevDay = dashWithMetrics.length > 1 ? dashWithMetrics[dashWithMetrics.length - 2] : null;
  const dashQualityDelta = dashLastDay && dashPrevDay ? dashLastDay.metrics.qualityScore - dashPrevDay.metrics.qualityScore : null;

  const dashTotalPages = Math.max(1, Math.ceil(dashDayRows.length / CARDS_PER_PAGE));
  const dashSafePage = Math.min(cardsPage, dashTotalPages - 1);
  const dashPageRows = dashDayRows.slice(dashSafePage * CARDS_PER_PAGE, dashSafePage * CARDS_PER_PAGE + CARDS_PER_PAGE);

  const dashFromV = cmpFromDay ? Number(cmpFromDay) : null;
  const dashToV = cmpToDay ? Number(cmpToDay) : null;
  const dashRangeRows = (dashFromV != null && dashToV != null)
    ? dashDayRows.filter((d) => d.version >= Math.min(dashFromV, dashToV) && d.version <= Math.max(dashFromV, dashToV) && d.metrics)
    : [];

  // Report section: group reports by comparison/series so each comparison's
  // reports live in their own collapsible folder ("View More"-style expand).
  const groupedReports = useMemo(() => {
    const groups = {};
    reports.forEach((item) => {
      let key = 'one_off';
      let title = 'One-off Comparisons';
      let groupType = 'one-off';

      if (item.meta) {
        if (item.meta.type === 'series') {
          key = `series_${item.meta.series_id}`;
          title = item.meta.series_name;
          groupType = 'series';
        }
      }

      if (!groups[key]) {
        groups[key] = {
          key,
          title,
          groupType,
          totalVersions: item.meta?.series_total_versions || 0,
          createdAt: item.meta?.series_created_at || '',
          items: [],
        };
      }
      groups[key].items.push(item);
    });

    // Sort reports within each series chronologically by version
    Object.values(groups).forEach((g) => {
      if (g.groupType === 'series') {
        g.items.sort((a, b) => (a.meta?.version || 0) - (b.meta?.version || 0));
      }
    });

    return Object.values(groups);
  }, [reports]);

  const toggleFolder = (key) => {
    setExpandedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
          {isAdmin && (
            <button className={`nav-item ${activeView === 'admin' ? 'active' : ''}`} onClick={() => setActiveView('admin')}><Icon.Dashboard /> Admin</button>
          )}
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
                    <button type="button" className="dash-btn-primary" onClick={() => { startNew(); setActiveView('reconcile'); }}>
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
              {/* ── Live KPI strip + clock — always visible on the Reconcile ── */}
              {/* tab, day by day, whether or not a comparison is open yet.    */}
              <section className="content-card dashboard-panel">
                <div className="top-row">
                  <h2 style={{ margin: 0 }}>Live Reconciliation Dashboard</h2>
                  <div className="dash-clock">
                    <div className="dash-clock-time">{clockNow.toLocaleTimeString('en-US', { hour12: false })}</div>
                    <div className="dash-clock-date">
                      {clockNow.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })}
                    </div>
                  </div>
                </div>

                <div className="kpi-strip">
                  <div className="kpi-tile" style={{ '--kpi-color': 'var(--primary)' }}>
                    <div className="kpi-tile-label">Next Run</div>
                    <div className="kpi-tile-value">Day {dashNextDay}</div>
                  </div>
                  <div className="kpi-tile" style={{ '--kpi-color': '#2dd4bf' }}>
                    <div className="kpi-tile-label">Total Runs Completed</div>
                    <div className="kpi-tile-value">{dashTotalRuns}</div>
                  </div>
                  <div className="kpi-tile" style={{ '--kpi-color': '#5b8def' }}>
                    <div className="kpi-tile-label">Records Reconciled (All-Time)</div>
                    <div className="kpi-tile-value">{dashRecordsAllTime.toLocaleString('en-US')}</div>
                  </div>
                  <div className="kpi-tile" style={{ '--kpi-color': '#f2b84b' }}>
                    <div className="kpi-tile-label">Avg Match Rate</div>
                    <div className="kpi-tile-value">{dashAvgMatchRate === null ? '—' : `${dashAvgMatchRate.toFixed(1)}%`}</div>
                  </div>
                  <div className="kpi-tile" style={{ '--kpi-color': '#a78bfa' }}>
                    <div className="kpi-tile-label">Last Data Quality Score</div>
                    <div className="kpi-tile-value">
                      {dashLastDay ? `${dashLastDay.metrics.qualityScore.toFixed(1)}%` : '—'}
                      {dashQualityDelta !== null && (
                        <span className={`kpi-trend ${dashQualityDelta >= 0 ? 'up' : 'down'}`}>
                          {dashQualityDelta >= 0 ? '▲' : '▼'} {Math.abs(dashQualityDelta).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {metricsLoading && <p className="muted" style={{ marginTop: 4 }}>Loading day-by-day metrics…</p>}
                {!activeSeries && <p className="muted" style={{ marginTop: 4 }}>Start or open a comparison below to populate these day by day.</p>}
              </section>

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
                      <input ref={uploadInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files[0] || null; setUploadFile(f); fetchColumns(f); setArResult(null); setArError(''); setCalcResults(null); setCalcSourceCol(''); setCalcTargetCol(''); if (f) { const det = await detectFileType(f); setSrcDetection(det); } else { setSrcDetection(null); } }} />
                      <button type="button" className="file-input-label" onClick={() => uploadInputRef.current?.click()}>
                        {uploadFile ? `📄 ${uploadFile.name}` : (mode === 'new' ? 'Choose Baseline File' : 'Choose File to Compare')}
                      </button>
                      {uploadFile && <div className="selected-file"><strong>{uploadFile.name}</strong><span>{Math.round(uploadFile.size / 1024)} KB</span></div>}
                    </div>

                    <label>
                      Data type
                      <select
                        className="search-input"
                        value={dataType}
                        onChange={(e) => setDataType(e.target.value)}
                        disabled={mode === 'series'}
                      >
                        <option value="auto">Auto-detect</option>
                        <option value="master">Master data</option>
                        <option value="transactional">Transactional data</option>
                      </select>
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        {mode === 'series'
                          ? `This comparison uses ${dataType === 'transactional' ? 'transactional' : 'master'} data matching.`
                          : 'Transactional matching preserves repeated business keys, such as multiple invoice lines.'}
                      </span>
                    </label>

                    {mode === 'new' && (
                      <label className="upload-row" style={{ alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={useDummyServer}
                          onChange={(e) => { setUseDummyServer(e.target.checked); if (e.target.checked) setUploadFile2(null); }}
                        />
                        Fetch Target automatically from Dummy Server (upload Source only)
                      </label>
                    )}

                    {mode === 'new' && useDummyServer && (
                      <label className="upload-row" style={{ alignItems: 'center', gap: 8 }}>
                        Target dataset
                        <select
                          className="search-input"
                          value={targetProject}
                          onChange={(e) => setTargetProject(e.target.value)}
                          style={{ flex: 1 }}
                        >
                          {targetProjects.length === 0 && <option value="">Loading target datasets…</option>}
                          {targetProjects.map((p) => (
                            <option key={p.project_name} value={p.project_name}>{p.label}</option>
                          ))}
                        </select>
                        <button type="button" className="secondary" onClick={fetchTargetProjects} title="Refresh target dataset list">↻</button>
                      </label>
                    )}

                    {mode === 'new' && !useDummyServer && (
                      <div className="upload-row">
                        <input ref={uploadInputRef2} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files[0] || null; setUploadFile2(f); if (f) { const det = await detectFileType(f); setTgtDetection(det); } else { setTgtDetection(null); } }} />
                        <button type="button" className="file-input-label" onClick={() => uploadInputRef2.current?.click()}>
                          {uploadFile2 ? `📄 ${uploadFile2.name}` : 'Choose File to Compare'}
                        </button>
                        {uploadFile2 && <div className="selected-file"><strong>{uploadFile2.name}</strong><span>{Math.round(uploadFile2.size / 1024)} KB</span></div>}
                      </div>
                    )}

                    {(mode === 'series' || (mode === 'new' && (uploadFile2 || useDummyServer))) && (
                      <label>
                        Key column
                        <div className="upload-row">
                          {columnsLoading ? (
                            <span className="muted" style={{ fontSize: '0.85rem' }}>Reading columns…</span>
                          ) : uploadColumns.length > 0 ? (
                            <select
                              className="search-input"
                              value={uploadKeyCol}
                              onChange={(e) => setUploadKeyCol(e.target.value)}
                              style={{ flex: 1 }}
                            >
                              <option value="">— auto-detect —</option>
                              {uploadColumns.map((col) => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                          ) : (
                            <input className="search-input" placeholder="e.g. transaction_id or Project Name" value={uploadKeyCol} onChange={(e) => setUploadKeyCol(e.target.value)} style={{ flex: 1 }} />
                          )}
                        </div>
                      </label>
                    )}
                  </div>

                  <aside className="action-frame">
                    {(() => {
                      const bothTransactional = srcDetection?.file_type === 'transactional' && tgtDetection?.file_type === 'transactional';
                      if (mode === 'new' && !useDummyServer && bothTransactional && uploadFile && uploadFile2) {
                        return (
                          <>
                            <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 6 }}>⚡ Both files detected as transactional — AR reconciliation mode</div>
                            <button type="button" className="run-btn" onClick={() => runArReconcile(uploadFile, uploadFile2)} disabled={arRunning}>
                              {arRunning ? 'Running AR Reconcile…' : 'Run AR Reconcile'}
                            </button>
                            <button type="button" className="secondary" style={{ marginTop: 6 }} onClick={useDummyServer ? autoReconcile : createSeries} disabled={seriesLoading || !uploadFile}>
                              Run Standard Reconcile Instead
                            </button>
                          </>
                        );
                      }
                      if (mode === 'new') {
                        return (
                          <button type="button" className="run-btn" onClick={useDummyServer ? autoReconcile : createSeries} disabled={seriesLoading || !uploadFile}>
                            {useDummyServer
                              ? (seriesLoading ? 'Fetching Target…' : 'Fetch Target & Compare')
                              : (seriesLoading ? (uploadFile2 ? 'Comparing…' : 'Starting…') : (uploadFile2 ? 'Start & Compare' : 'Start Comparison'))}
                          </button>
                        );
                      }
                      return (
                        <>
                          <button type="button" className="run-btn" onClick={addVersion} disabled={addingVersion || !uploadFile}>
                            {addingVersion ? 'Reconciling…' : 'Upload & Reconcile'}
                          </button>
                          <button type="button" className="secondary" onClick={() => deleteSeries(activeSeries.series.series_id, activeSeries.series.name)}>Delete Comparison</button>
                        </>
                      );
                    })()}
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

              {/* ── Day-by-Day Scoreboard: paginated cards (4 per page, ── */}
              {/* Prev/Next), EDA report trigger, and range comparison.    */}
              {mode === 'series' && activeSeries && (
                <section className="content-card dashboard-panel">
                  <div className="top-row">
                    <h3 style={{ margin: 0 }}>Reconciliation Scoreboard — Day by Day</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {dashDayRows.length > CARDS_PER_PAGE && (
                        <div className="cards-pager">
                          <button type="button" className="secondary" disabled={dashSafePage <= 0} onClick={() => setCardsPage(dashSafePage - 1)}>← Prev</button>
                          <span className="pager-label">
                            {dashPageRows.length > 1
                              ? `Day ${dashPageRows[0].version} – Day ${dashPageRows[dashPageRows.length - 1].version}`
                              : `Day ${dashPageRows[0]?.version ?? ''}`} · page {dashSafePage + 1} of {dashTotalPages}
                          </span>
                          <button type="button" className="secondary" disabled={dashSafePage >= dashTotalPages - 1} onClick={() => setCardsPage(dashSafePage + 1)}>Next →</button>
                        </div>
                      )}
                      <button type="button" className="secondary" disabled={!dashDayRows.length} onClick={() => setShowCmpModal(true)}>View More →</button>
                    </div>
                  </div>

                  {!dashDayRows.length ? (
                    <p className="muted">No days reconciled yet — upload the next file above to create Day 1.</p>
                  ) : (
                    <div className="day-cards-grid">
                      {dashPageRows.map((d) => (
                        <div key={d.version} className="day-card">
                          <div className="day-card-head">
                            <span className="day-card-badge">Day {d.version}</span>
                            <span className="day-card-time">{formatUploadedAt(d.uploadedAt)}</span>
                          </div>
                          <div className="day-card-files">{d.sourceLabel || '—'} → {d.targetLabel || d.label}</div>
                          {d.metrics ? (
                            <>
                              <div className="day-card-stats">
                                <span>Matched <b>{d.metrics.matched.toLocaleString('en-US')}</b></span>
                                <span>Updated <b>{d.metrics.updated.toLocaleString('en-US')}</b></span>
                                <span>Inserted <b>{d.metrics.inserted.toLocaleString('en-US')}</b></span>
                                <span>Missing <b>{d.metrics.missing.toLocaleString('en-US')}</b></span>
                                <span>Duplicate <b>{d.metrics.duplicates.toLocaleString('en-US')}</b></span>
                              </div>
                              <div className="day-card-quality">
                                <span className="muted">Quality Score</span>
                                <span className="day-card-quality-value">{d.metrics.qualityScore.toFixed(1)}%</span>
                              </div>
                              <div className="day-card-quality-track">
                                <span className="day-card-quality-fill" style={{ width: `${d.metrics.qualityScore}%` }} />
                              </div>
                            </>
                          ) : (
                            <p className="muted">Loading metrics…</p>
                          )}
                          <div className="day-card-foot">
                            <span className="muted">{d.procMs != null ? `Processed in ${(d.procMs / 1000).toFixed(2)}s` : 'Processing time not recorded'}</span>
                            <button type="button" className="secondary" disabled={!d.metrics} onClick={() => setEdaDay(d.version)}>View EDA Report</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </section>
              )}

              {/* ── AR Reconcile results (transactional auto-detect) ──────── */}
              {arError && (
                <section className="content-card result-section">
                  <div className="error-banner">{arError}</div>
                </section>
              )}
              {arResult && (() => {
                const tabs = [
                  { key: 'summary', label: 'Summary' },
                  { key: 'matched', label: `Matched (${arResult.matched?.length ?? 0})` },
                  { key: 'disputed', label: `Disputed / Amount Mismatch (${arResult.disputed?.length ?? 0})` },
                  { key: 'unmatched_src', label: `Only in Source (${arResult.unmatched_source?.length ?? 0})` },
                  { key: 'unmatched_tgt', label: `Only in Target (${arResult.unmatched_target?.length ?? 0})` },
                  { key: 'tier2', label: `Tier-2 (${arResult.tier2_rows?.length ?? 0})` },
                  { key: 'dup_src', label: `Dup Keys Src (${arResult.duplicate_source_rows?.length ?? 0})` },
                  { key: 'dup_tgt', label: `Dup Keys Tgt (${arResult.duplicate_target_rows?.length ?? 0})` },
                  { key: 'exc_src', label: `Exceptions Src (${arResult.source_exceptions?.length ?? 0})` },
                  { key: 'exc_tgt', label: `Exceptions Tgt (${arResult.target_exceptions?.length ?? 0})` },
                ];
                const s = arResult.summary || {};
                const fmtAmt = (v) => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
                const netColor = (s.invoice_difference ?? s.net_diff) == null ? 'inherit' : (s.invoice_difference ?? s.net_diff) === 0 ? '#22c55e' : (s.invoice_difference ?? s.net_diff) < 0 ? '#ef4444' : '#f59e0b';
                const renderArTable = (rows) => {
                  if (!rows?.length) return <p className="muted">No records.</p>;
                  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set()));
                  return (
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>{rows.slice(0, 100).map((row, i) => (
                          <tr key={i}>{cols.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
                        ))}</tbody>
                      </table>
                      {rows.length > 100 && <p className="muted">Showing first 100 of {rows.length} rows.</p>}
                    </div>
                  );
                };
                return (
                  <section className="content-card result-section">
                    <div className="top-row">
                      <h2>AR Reconciliation Results</h2>
                      <button type="button" className="secondary" onClick={() => { setArResult(null); setArError(''); setSrcDetection(null); setTgtDetection(null); }}>✕ Clear</button>
                    </div>
                    <div className="version-chip-row" style={{ marginBottom: 16 }}>
                      {tabs.map((t) => (
                        <button key={t.key} type="button" className={`version-chip ${arActiveTab === t.key ? 'selected' : ''}`} onClick={() => setArActiveTab(t.key)}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {arActiveTab === 'summary' && (
                      <>
                        {/* Invoice amount totals — the three primary financial values */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                          {[
                            { label: 'Source Total Invoice Amount', value: fmtAmt(s.source_invoice_total ?? s.source_total), color: 'var(--primary)' },
                            { label: 'Target Total Invoice Amount', value: fmtAmt(s.target_invoice_total ?? s.target_total), color: 'var(--primary)' },
                            { label: 'Difference (Source − Target)', value: fmtAmt(s.invoice_difference ?? s.net_diff), color: netColor },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="card" style={{ borderColor: color, textAlign: 'center' }}>
                              <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>{label}</h3>
                              <p style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</p>
                            </div>
                          ))}
                        </div>
                        {/* Count summary cards */}
                        <div className="cards">
                          {[
                            ['Matched Txns', s.matched ?? 0],
                            ['Amount Mismatch', s.amount_mismatch ?? 0],
                            ['Only in Source (Deleted / Unmatched)', s.only_in_source ?? 0],
                            ['Only in Target (Added / Unmatched)', s.only_in_target ?? 0],
                            ['Tier-2 Matches', s.tier2_matches ?? 0],
                            ['Src Exceptions', s.source_exceptions ?? 0],
                            ['Tgt Exceptions', s.target_exceptions ?? 0],
                            ['Dup Keys (Src)', s.duplicate_keys_source ?? 0],
                            ['Dup Keys (Tgt)', s.duplicate_keys_target ?? 0],
                            ['Tolerance', `±${s.tolerance ?? 0.01}`],
                          ].map(([label, value]) => <div key={label} className="card"><h3>{label}</h3><p>{value}</p></div>)}
                        </div>
                      </>
                    )}
                    {arActiveTab === 'matched' && renderArTable(arResult.matched)}
                    {arActiveTab === 'disputed' && renderArTable(arResult.disputed)}
                    {arActiveTab === 'unmatched_src' && (
                      <div>
                        <div className="card" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.06)', padding: '12px 16px', marginBottom: 14, borderRadius: 10 }}>
                          <h3 style={{ margin: 0, fontSize: '0.88rem', color: '#ef4444', fontWeight: 700 }}>🔴 Only in Source — Missing in Target</h3>
                          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                            A transaction exists in the Source system but was never recorded (or was deleted) in the Target system.
                          </p>
                        </div>
                        {renderArTable(arResult.unmatched_source)}
                      </div>
                    )}
                    {arActiveTab === 'unmatched_tgt' && (
                      <div>
                        <div className="card" style={{ borderColor: 'rgba(34, 197, 94, 0.4)', background: 'rgba(34, 197, 94, 0.06)', padding: '12px 16px', marginBottom: 14, borderRadius: 10 }}>
                          <h3 style={{ margin: 0, fontSize: '0.88rem', color: '#22c55e', fontWeight: 700 }}>🟢 Only in Target — Missing in Source</h3>
                          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                            A transaction exists in the Target system but was never recorded (or was added new) in the Source system.
                          </p>
                        </div>
                        {renderArTable(arResult.unmatched_target)}
                      </div>
                    )}
                    {arActiveTab === 'tier2' && renderArTable(arResult.tier2_rows)}
                    {arActiveTab === 'dup_src' && renderArTable(arResult.duplicate_source_rows)}
                    {arActiveTab === 'dup_tgt' && renderArTable(arResult.duplicate_target_rows)}
                    {arActiveTab === 'exc_src' && renderArTable(arResult.source_exceptions)}
                    {arActiveTab === 'exc_tgt' && renderArTable(arResult.target_exceptions)}
                  </section>
                );
              })()}

              {/* ── Results (full reconcile layout) ───────────────────────── */}
              {!arResult && mode === 'series' && activeSeries && (
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
                                <span className={`pill ${s.data_type === 'transactional' ? 'data-type-transactional' : 'data-type-master'}`}>
                                  {s.data_type === 'transactional' ? 'Transactional' : 'Master'}
                                </span>
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
                {groupedReports.map((group) => {
                  const isFolderExpanded = !!expandedFolders[group.key];
                  return (
                    <Fragment key={group.key}>
                      <div className={`stored-file-row ${isFolderExpanded ? 'active' : ''}`}>
                        <div className="stored-file-info" style={{ cursor: 'pointer' }} onClick={() => toggleFolder(group.key)}>
                          <span className="file-icon">{isFolderExpanded ? '📂' : '📁'}</span>
                          <div>
                            <div className="file-name">
                              {group.title}
                              {group.groupType === 'series' && (
                                <span className="pill baseline-pill" style={{ marginLeft: 8, background: 'rgba(6, 182, 212, 0.12)', borderColor: 'rgba(6, 182, 212, 0.3)', color: '#06b6d4' }}>
                                  {group.totalVersions} versions
                                </span>
                              )}
                            </div>
                            <div className="file-meta">
                              {group.groupType === 'series'
                                ? `Comparison Stream · uploaded ${formatUploadedAt(group.createdAt)} · ${group.items.length} report${group.items.length !== 1 ? 's' : ''}`
                                : `Comparison Stream · ${group.items.length} report${group.items.length !== 1 ? 's' : ''}`
                              }
                            </div>
                          </div>
                        </div>
                        <div className="file-card-actions">
                          <button type="button" className="secondary" onClick={() => toggleFolder(group.key)}>
                            {isFolderExpanded ? '▲ Hide Reports' : '▼ Show Reports'}
                          </button>
                        </div>
                      </div>

                      {isFolderExpanded && (
                        <div className="target-files-list">
                          {group.items.map((item) => {
                            const { label, timestamp } = formatReportName(item.filename);

                            const reportTitle = item.meta && item.meta.type === 'series'
                              ? `Version ${item.meta.version} (${item.meta.prev_label} → ${item.meta.curr_label})`
                              : label;

                            const isLoadedInMemory = selectedReport?.reportFile === item.filename;
                            const isExpanded = expandedReportFile === item.filename;

                            return (
                              <div key={item.filename} className="report-row-wrap" style={{ margin: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: 12 }}>
                                <div className="report-row" style={{ background: 'rgba(255, 255, 255, 0.015)', borderStyle: 'dashed' }}>
                                  <div className="report-info">
                                    <span className="file-icon">📊</span>
                                    <div>
                                      <div className="file-name">{reportTitle}</div>
                                      <div className="file-meta">{timestamp ? formatUploadedAt(timestamp.replace(' ', 'T').replace(' UTC', 'Z')) : ''}</div>
                                    </div>
                                  </div>
                                  <div className="file-card-actions">
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
                      )}
                    </Fragment>
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

      {/* ── EDA Report modal — opened from the day-by-day scoreboard above ── */}
      {edaDay !== null && activeSeries && versionReports[edaDay] && (() => {
        const payload = versionReports[edaDay];
        // Show AR financial summary whenever an AR result is in state —
        // arResult is set by runArReconcile() and stays until cleared.
        // The EDA modal is opened from the scoreboard (series flow) so
        // arResult?.summary is the only reliable signal that AR data exists.
        const isTransactional = payload.dataType === 'transactional' || !!(arResult?.summary);
        const isAR = !!(arResult?.summary);
        const arSum = isAR ? arResult.summary : null;
        const metrics = computeRunMetrics(payload.report);
        const summaryCards = computeSummary(payload.report, payload.beforeLabel, payload.afterLabel);
        const versionMeta = (activeSeries.series.versions || []).find((vv) => vv.version === edaDay);

        // AR-specific KPI cells derived from arResult.summary
        const arKpiCells = arSum ? [
          ['Source Records', arSum.source_records],
          ['Target Records', arSum.target_records],
          ['Matched Txns', arSum.matched],
          ['Amount Mismatch', arSum.amount_mismatch],
          ['Only in Source', arSum.only_in_source],
          ['Only in Target', arSum.only_in_target],
          ['Tier-2 Matches', arSum.tier2_matches],
          ['Src Exceptions', arSum.source_exceptions],
          ['Tgt Exceptions', arSum.target_exceptions],
          ['Dup Keys (Src)', arSum.duplicate_keys_source],
          ['Dup Keys (Tgt)', arSum.duplicate_keys_target],
        ] : [];

        // Match rate for AR
        const arMatchRate = arSum && arSum.source_records > 0
          ? ((arSum.matched / arSum.source_records) * 100).toFixed(1)
          : null;

        const fmtAmt = (v) => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

        // Net diff colour: green if 0, red if negative, amber if positive
        const netDiffColor = (arSum?.invoice_difference ?? arSum?.net_diff) == null ? 'var(--muted)'
          : (arSum.invoice_difference ?? arSum.net_diff) === 0 ? '#22c55e'
          : (arSum.invoice_difference ?? arSum.net_diff) < 0 ? '#ef4444' : '#f59e0b';

        return (
          <div className="eda-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEdaDay(null); }}>
            <div className="eda-modal">
              <div className="eda-modal-head">
                <div>
                  <div className="eda-eyebrow">Reconciliation EDA Report</div>
                  <h2 style={{ margin: '2px 0 0' }}>Day {edaDay}</h2>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {payload.beforeLabel} → {payload.afterLabel} · {formatUploadedAt(versionMeta?.uploaded_at)}
                    {payload.keyColumns?.length ? ` · key: ${payload.keyColumns.join(', ')}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className="secondary" onClick={() => setEdaDay(null)}>✕ Close</button>
                </div>
              </div>

              {/* ── KPI strip: AR-specific or master-data ── */}
              {isTransactional && isAR ? (
                <>
                  <div className="eda-kpi-cells">
                    {arKpiCells.map(([l, val]) => (
                      <div key={l} className="eda-cell">
                        <div className="eda-cell-label">{l}</div>
                        <div className="eda-cell-value">{val ?? 0}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── AR financial summary ── */}
                  <section className="content-card result-section" style={{ marginTop: 16 }}>
                    <div className="top-row">
                      <h2>AR Financial Summary</h2>
                      {arMatchRate !== null && (
                        <span className="pill" style={{ background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.3)', color: '#22c55e' }}>
                          Match Rate {arMatchRate}%
                        </span>
                      )}
                    </div>

                    {/* Invoice amount totals — prominent 3-column row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
                      {[
                        { label: 'Source Total Invoice Amount', value: fmtAmt(arSum.source_invoice_total ?? arSum.source_total), color: 'var(--primary)' },
                        { label: 'Target Total Invoice Amount', value: fmtAmt(arSum.target_invoice_total ?? arSum.target_total), color: 'var(--primary)' },
                        { label: 'Difference (Source − Target)', value: fmtAmt(arSum.invoice_difference ?? arSum.net_diff), color: netDiffColor },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="card" style={{ borderColor: color, textAlign: 'center' }}>
                          <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>{label}</h3>
                          <p style={{ fontSize: '1.35rem', fontWeight: 700, color }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Exception / duplicate counts */}
                    <div className="cards">
                      {[
                        ['Source Exceptions', arSum.source_exceptions ?? 0],
                        ['Target Exceptions', arSum.target_exceptions ?? 0],
                        ['Dup Keys (Src)', arSum.duplicate_keys_source ?? 0],
                        ['Dup Keys (Tgt)', arSum.duplicate_keys_target ?? 0],
                        ['Matched Txns', arSum.matched ?? 0],
                        ['Amount Mismatch', arSum.amount_mismatch ?? 0],
                        ['Unmatched (Src)', arSum.only_in_source ?? 0],
                        ['Unmatched (Tgt)', arSum.only_in_target ?? 0],
                        ['Tier-2 Matches', arSum.tier2_matches ?? 0],
                        ['Tolerance', `±${arSum.tolerance ?? 0.01}`],
                      ].map(([label, value]) => (
                        <div key={label} className="card"><h3>{label}</h3><p>{value}</p></div>
                      ))}
                    </div>
                  </section>

                  {/* ── AR breakdown pie chart ── */}
                  <section className="content-card result-section" style={{ marginTop: 16 }}>
                    <h2>Transaction Breakdown</h2>
                    <div className="day-wise-viz">
                      <DayWisePieChart segments={[
                        { label: 'Matched', value: arSum.matched, color: '#22c55e' },
                        { label: 'Amount Mismatch', value: arSum.amount_mismatch, color: '#f59e0b' },
                        { label: 'Only in Source', value: arSum.only_in_source, color: '#ef4444' },
                        { label: 'Only in Target', value: arSum.only_in_target, color: '#3b82f6' },
                        { label: 'Tier-2', value: arSum.tier2_matches, color: '#a855f7' },
                        { label: 'Exceptions', value: (arSum.source_exceptions || 0) + (arSum.target_exceptions || 0), color: '#94a3b8' },
                      ].filter((s) => s.value > 0)} />
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <div className="eda-kpi-cells">
                    {[
                      ['Total', metrics.total], ['Matched', metrics.matched], ['Updated', metrics.updated],
                      ['Inserted', metrics.inserted], ['Missing', metrics.missing], ['Duplicate', metrics.duplicates],
                      ['Quality', `${metrics.qualityScore.toFixed(1)}%`],
                    ].map(([l, val]) => (
                      <div key={l} className="eda-cell">
                        <div className="eda-cell-label">{l}</div>
                        <div className="eda-cell-value">{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Invoice totals for transactional series (non-AR) */}
                  {isTransactional && (() => {
                    const inv = payload.report?.invoice_summary;
                    // Fallback: compute from full_comparison rows if invoice_summary not in saved report
                    let srcTotal = inv?.source_invoice_total;
                    let tgtTotal = inv?.target_invoice_total;
                    let amtCol = inv?.amount_column;
                    if (srcTotal == null && payload.report?.full_comparison?.rows?.length) {
                      const rows = payload.report.full_comparison.rows;
                      const sampleSrc = rows.find(r => r.source_row && Object.keys(r.source_row).length)?.source_row || {};
                      const sampleTgt = rows.find(r => r.target_row && Object.keys(r.target_row).length)?.target_row || {};
                      const amtKeywords = ['amount','amt','value','total','price','sum','debit','credit'];
                      amtCol = Object.keys(sampleSrc).find(k => amtKeywords.some(w => k.toLowerCase().includes(w)));
                      // Target may use a different column name — find independently
                      const tgtAmtCol = Object.keys(sampleTgt).find(k => amtKeywords.some(w => k.toLowerCase().includes(w)));
                      if (amtCol || tgtAmtCol) {
                        const parseAmt = (v) => parseFloat(String(v ?? '').replace(/[$,]/g, '')) || 0;
                        srcTotal = rows.reduce((s, r) => {
                          const keys = Object.keys(r.source_row || {});
                          if (!keys.length) return s;
                          const col = amtCol && keys.includes(amtCol) ? amtCol : keys.find(k => amtKeywords.some(w => k.toLowerCase().includes(w)));
                          return s + (col ? parseAmt(r.source_row[col]) : 0);
                        }, 0);
                        tgtTotal = rows.reduce((s, r) => {
                          const keys = Object.keys(r.target_row || {});
                          if (!keys.length) return s;
                          const col = tgtAmtCol && keys.includes(tgtAmtCol) ? tgtAmtCol : keys.find(k => amtKeywords.some(w => k.toLowerCase().includes(w)));
                          return s + (col ? parseAmt(r.target_row[col]) : 0);
                        }, 0);
                        amtCol = amtCol || tgtAmtCol;
                      }
                    }
                    if (srcTotal == null) return null;
                    const diff = srcTotal - tgtTotal;
                    const fmtAmt = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
                    const diffColor = Math.abs(diff) < 0.01 ? '#22c55e' : diff < 0 ? '#ef4444' : '#f59e0b';
                    return (
                      <section className="content-card result-section" style={{ marginTop: 16 }}>
                        <div className="top-row">
                          <h2>Invoice Financial Summary</h2>
                          {amtCol && <span className="pill" style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Column: {amtCol}</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                          {[
                            { label: 'Source Total Invoice Amount', value: fmtAmt(srcTotal), color: 'var(--primary)' },
                            { label: 'Target Total Invoice Amount', value: fmtAmt(tgtTotal), color: 'var(--primary)' },
                            { label: 'Difference (Source − Target)', value: fmtAmt(diff), color: diffColor },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="card" style={{ borderColor: color, textAlign: 'center' }}>
                              <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>{label}</h3>
                              <p style={{ fontSize: '1.35rem', fontWeight: 700, color }}>{value}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })()}

                  <section className="content-card result-section" style={{ marginTop: 16 }}>
                    <div className="top-row">
                      <h2>Comparison Summary <span className="muted" style={{ fontWeight: 600 }}>— {payload.beforeLabel} → {payload.afterLabel}</span></h2>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className="pill">Keys: {payload.keyColumns?.length ? payload.keyColumns.join(', ') : 'auto-detected'}</span>
                      </div>
                    </div>
                    <div className="cards">
                      {summaryCards.map(([label, value]) => <div key={label} className="card"><h3>{label}</h3><p>{value ?? 0}</p></div>)}
                    </div>
                  </section>
                </>
              )}

              {payload.insights?.narrative?.length ? (
                <div className="insights-panel" style={{ marginTop: 16 }}>
                  <div className="insights-header">
                    <h3 style={{ margin: 0 }}>What's happening in this data</h3>
                    <span className={`churn-badge churn-${churnLevelKey(payload.insights.churn_percent)}`}>
                      {payload.insights.churn_label} · {payload.insights.churn_percent}% of rows touched
                    </span>
                  </div>
                  <ul className="insights-list">
                    {payload.insights.narrative.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              ) : null}

              {!isTransactional && payload.insights?.top_columns?.length ? (
                <div style={{ marginTop: 16 }}>
                  <div className="rf-title">Most frequently changed fields</div>
                  {payload.insights.top_columns.map((c) => (
                    <div key={c.column} className="rf-row">
                      <span className="rf-name">{c.column}</span>
                      <span className="rf-track">
                        <span className="rf-fill" style={{ width: `${Math.min(100, (c.changes / payload.insights.top_columns[0].changes) * 100)}%` }} />
                      </span>
                      <span className="rf-count">{c.changes} change{c.changes === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {payload.reportFile && (
                <div style={{ marginTop: 16 }}>
                  <button type="button" className="secondary" onClick={() => downloadReport(payload.reportFile)}>⬇ Download Excel Report</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Day-by-Day Comparison popup — opened via "View More" on the ── */}
      {/* scoreboard above; now its own page/frame instead of an inline panel. */}
      {showCmpModal && mode === 'series' && activeSeries && (
        <div className="eda-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowCmpModal(false); }}>
          <div className="eda-modal cmp-modal">
            <div className="eda-modal-head">
              <div>
                <div className="eda-eyebrow">Reconciliation Scoreboard</div>
                <h2 style={{ margin: '2px 0 0' }}>Day-by-Day Comparison</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>Pick a From Day and a To Day to analyze performance across that range.</p>
              </div>
              <button type="button" className="secondary" onClick={() => setShowCmpModal(false)}>✕ Close</button>
            </div>

            <div className="dash-cmp-controls">
              <label>
                From Day
                <select value={cmpFromDay} onChange={(e) => setCmpFromDay(e.target.value)}>
                  <option value="">Select…</option>
                  {dashDayRows.map((d) => <option key={d.version} value={d.version}>Day {d.version}</option>)}
                </select>
              </label>
              <label>
                To Day
                <select value={cmpToDay} onChange={(e) => setCmpToDay(e.target.value)}>
                  <option value="">Select…</option>
                  {dashDayRows.map((d) => <option key={d.version} value={d.version}>Day {d.version}</option>)}
                </select>
              </label>
            </div>

            {!dashRangeRows.length ? (
              <p className="muted">Pick a From Day and a To Day to automatically analyze performance across that range.</p>
            ) : (() => {
              const first = dashRangeRows[0].metrics;
              const last = dashRangeRows[dashRangeRows.length - 1].metrics;
              const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
              const avgMatch = mean(dashRangeRows.map((d) => d.metrics.matchRate));
              const avgDup = mean(dashRangeRows.map((d) => d.metrics.duplicateRate));
              const avgQuality = mean(dashRangeRows.map((d) => d.metrics.qualityScore));
              const totalMatched = dashRangeRows.reduce((s, d) => s + d.metrics.matched, 0);
              const totalUpdated = dashRangeRows.reduce((s, d) => s + d.metrics.updated, 0);
              const totalInserted = dashRangeRows.reduce((s, d) => s + d.metrics.inserted, 0);
              const totalMissing = dashRangeRows.reduce((s, d) => s + d.metrics.missing, 0);
              const totalDuplicate = dashRangeRows.reduce((s, d) => s + d.metrics.duplicates, 0);
              const metricTiles = [
                ['Runs in Range', dashRangeRows.length],
                ['Average Match Rate', `${avgMatch.toFixed(1)}%`],
                ['Average Duplicate Rate', `${avgDup.toFixed(1)}%`],
                ['Average Quality Score', `${avgQuality.toFixed(1)}%`],
                ['Total Matched', totalMatched.toLocaleString('en-US')],
                ['Total Updated', totalUpdated.toLocaleString('en-US')],
                ['Total Inserted', totalInserted.toLocaleString('en-US')],
                ['Total Missing', totalMissing.toLocaleString('en-US')],
                ['Total Duplicate', totalDuplicate.toLocaleString('en-US')],
                ['Match Rate Change', `${last.matchRate - first.matchRate >= 0 ? '▲' : '▼'} ${Math.abs(last.matchRate - first.matchRate).toFixed(1)}%`],
                ['Quality Score Change', `${last.qualityScore - first.qualityScore >= 0 ? '▲' : '▼'} ${Math.abs(last.qualityScore - first.qualityScore).toFixed(1)}%`],
              ];
              return (
                <div className="cmp-result">
                  <div className="cmp-verdict-row">
                    <span>Performance Comparison (Day {dashRangeRows[0].version} → Day {dashRangeRows[dashRangeRows.length - 1].version})</span>
                  </div>
                  <div className="cmp-metrics-grid">
                    {metricTiles.map(([label, value]) => (
                      <div key={label} className="cmp-metric-tile">
                        <div className="cmp-metric-label">{label}</div>
                        <div className="cmp-metric-value">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="cmp-chart-wrap">
                    <ComparisonRangeChart list={dashRangeRows} />
                  </div>
                  <div className="data-table-wrap" style={{ marginTop: 14 }}>
                    <table className="data-table">
                      <thead><tr><th>Day</th><th>Match Rate</th><th>Duplicate Rate</th><th>Missing</th><th>Quality Score</th><th>Processing Time</th></tr></thead>
                      <tbody>
                        {dashRangeRows.map((d) => (
                          <tr key={d.version}>
                            <td>Day {d.version}</td>
                            <td>{d.metrics.matchRate.toFixed(1)}%</td>
                            <td>{d.metrics.duplicateRate.toFixed(1)}%</td>
                            <td>{d.metrics.missing.toLocaleString('en-US')}</td>
                            <td>{d.metrics.qualityScore.toFixed(1)}%</td>
                            <td>{d.procMs != null ? `${(d.procMs / 1000).toFixed(2)}s` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

          {activeView === 'admin' && isAdmin && (
            <section className="content-card result-section">
              <AdminPanel token={token} />
            </section>
          )}

      {/* ── Schema Mapping Modal ──────────────────────────────────────────── */}
      <SchemaMappingModal
        isOpen={showSchemaModal}
        onClose={() => setShowSchemaModal(false)}
        sourceFileName={uploadFile?.name || 'Source'}
        targetFileName={uploadFile2?.name || 'Target'}
        sourceColumns={schemaSourceCols}
        targetColumns={schemaTargetCols}
        onConfirmReconcile={handleConfirmReconcileModal}
        isReconciling={seriesLoading}
        uploadFile={uploadFile}
      />

      {/* ── Transaction Column Sums (computed from amount columns) ──────── */}
      {calcResults && calcResults.sumSource != null && (
        <section className="content-card result-section" style={{ marginTop: 20 }}>
          <div className="top-row">
            <h2>Transaction Amount Totals</h2>
            {calcLoading && <span className="pill" style={{ color: 'var(--muted)' }}>Computing…</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div className="card" style={{ borderColor: 'var(--primary)', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>Sum Source ({calcSourceCol})</h3>
              <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary)' }}>
                {Number(calcResults.sumSource).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card" style={{ borderColor: 'var(--accent)', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>Sum Target ({calcTargetCol})</h3>
              <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent)' }}>
                {Number(calcResults.sumTarget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card" style={{ borderColor: (calcResults.difference ?? 0) === 0 ? '#22c55e' : '#ef4444', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 6 }}>Difference (Source − Target)</h3>
              <p style={{ fontSize: '1.35rem', fontWeight: 700, color: (calcResults.difference ?? 0) === 0 ? '#22c55e' : '#ef4444' }}>
                {Number(calcResults.difference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </section>
      )}

      <ChatWidget apiBase={API_BASE} seed={chatSeed} seriesList={seriesList} token={token} />
    </div>
  );
}

export default App;