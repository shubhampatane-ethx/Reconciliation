import { useEffect, useRef, useState, Fragment } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// Reads just the header row of a .csv/.xlsx/.xls file in the browser so the
// "Key column" picker can offer real column names instead of asking the user
// to type one from memory.
async function readFileColumns(file) {
  if (!file) return [];
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', sheetRows: 1 });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const header = rows[0] || [];
    return header.map((cell) => String(cell ?? '').trim()).filter(Boolean);
  } catch (err) {
    console.error('Could not read columns from file', file?.name, err);
    return [];
  }
}

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

function App() {
  // ── General UI ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('reconcile');
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

  // ── Live dashboard: KPI strip, day-by-day scoreboard, EDA report, comparison ─
  // Purely additive — reads the same series/version data already fetched above,
  // it doesn't change how comparisons are created, stored, or displayed elsewhere.
  const [clockNow, setClockNow] = useState(new Date());
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [versionProcessingMs, setVersionProcessingMs] = useState({}); // `${seriesId}:${version}` -> real measured ms
  const [edaDay, setEdaDay] = useState(null);                   // version number currently open in the EDA modal
  const [cmpFromDay, setCmpFromDay] = useState('');
  const [cmpToDay, setCmpToDay] = useState('');
  const [cardsPage, setCardsPage] = useState(0);                 // day-scoreboard pagination — 4 cards per page
  const CARDS_PER_PAGE = 4;

  const [newSeriesName, setNewSeriesName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadFile2, setUploadFile2] = useState(null);        // second file, only used in 'new' mode
  const [uploadKeyCol, setUploadKeyCol] = useState('');
  const [uploadFileColumns, setUploadFileColumns] = useState([]);   // header row of uploadFile
  const [uploadFile2Columns, setUploadFile2Columns] = useState([]); // header row of uploadFile2 ('new' mode)
  const [seriesLatestColumns, setSeriesLatestColumns] = useState([]); // header row of the latest stored version ('series' mode)

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
    const response = await axios.get(`${API_BASE}/api/reports`);
    setReports(response.data.reports || []);
  };

  const fetchSeriesList = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/series`);
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
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`);
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
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}/history`);
      setValueHistory({ versions: res.data.versions || [], entries: res.data.entries || [] });
      setHistoryStatus('ready');
    } catch (err) {
      // 503 = Postgres not connected; anything else, just treat history as unavailable for now.
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
    setUploadFileColumns([]);
    setUploadFile2Columns([]);
    setSeriesLatestColumns([]);
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
    setUploadFileColumns([]);
    setUploadFile2Columns([]);
    setSeriesLatestColumns([]);
    try {
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`);
      const seriesData = res.data.series;
      setActiveSeries(res.data);
      setMode('series');
      fetchValueHistory(seriesId);
      // Fetch the latest version's column names so the "Key column" field
      // can offer a dropdown of real columns instead of free text.
      axios.get(`${API_BASE}/api/series/${seriesId}/columns`)
        .then((colsRes) => setSeriesLatestColumns(colsRes.data.columns || []))
        .catch(() => setSeriesLatestColumns([]));
      const versions = seriesData.versions;
      const latest = versions[versions.length - 1];
      if (latest && latest.version > 0) {
        setSelectedVersion(latest.version);
        const rep = await axios.get(`${API_BASE}/api/series/${seriesId}/versions/${latest.version}/report`);
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

  const handleUploadFileChange = (file) => {
    setUploadFile(file);
    setUploadKeyCol('');
    if (!file) { setUploadFileColumns([]); return; }
    readFileColumns(file).then(setUploadFileColumns);
  };

  const handleUploadFile2Change = (file) => {
    setUploadFile2(file);
    setUploadKeyCol('');
    if (!file) { setUploadFile2Columns([]); return; }
    readFileColumns(file).then(setUploadFile2Columns);
  };

  const selectVersion = async (version) => {
    if (!activeSeries) return;
    setSelectedVersion(version);
    if (version === 0) { setSelectedReport(null); return; }
    if (versionReports[version]) { setSelectedReport(versionReports[version]); return; }
    try {
      const res = await axios.get(`${API_BASE}/api/series/${activeSeries.series.series_id}/versions/${version}/report`);
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
      const res = await axios.post(`${API_BASE}/api/series`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const seriesId = res.data.series.series_id;

      // If a second file was also chosen up front, immediately add it as the first version
      // so the user sees a real comparison right away instead of an empty baseline state.
      if (uploadFile2) {
        const fd2 = new FormData();
        fd2.append('file', uploadFile2);
        if (uploadKeyCol.trim()) fd2.append('key_columns', uploadKeyCol.trim());
        try {
          await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd2, { headers: { 'Content-Type': 'multipart/form-data' } });
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
      const startedAt = performance.now();
      const addRes = await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const elapsedMs = performance.now() - startedAt;
      const newVersion = addRes.data?.version?.version;
      if (newVersion != null) {
        setVersionProcessingMs((prev) => ({ ...prev, [`${seriesId}:${newVersion}`]: elapsedMs }));
      }
      setSeriesDetailCache((prev) => { const next = { ...prev }; delete next[seriesId]; return next; });
      await fetchSeriesList();
      await openSeries(seriesId);            // auto-selects the newly added version
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
      await axios.delete(`${API_BASE}/api/series/${seriesId}`);
      if (activeSeries?.series?.series_id === seriesId) startNew();
      if (expandedSeriesId === seriesId) setExpandedSeriesId(null);
      setSeriesDetailCache((prev) => {
        const next = { ...prev };
        delete next[seriesId];
        return next;
      });
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
      const res = await axios.delete(`${API_BASE}/api/series`);
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
      await axios.delete(`${API_BASE}/api/reports/${filename}`);
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
      const res = await axios.delete(`${API_BASE}/api/reports`);
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
      axios.get(`${API_BASE}/api/series/${seriesId}/versions/${v.version}/report`)
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
  // Multi-line SVG chart for the Day-by-Day Comparison panel — one line per
  // metric (match rate, duplicate rate, quality score, missing-as-% of total),
  // plotted across every day in the selected From→To range. Same shape as the
  // comparison chart in the standalone Ledger mock, redrawn in JSX/SVG.
  const ComparisonRangeChart = ({ list }) => {
    const W = 760, H = 240, padL = 42, padR = 16, padT = 16, padB = 30;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const n = list.length;
    const xFor = (i) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
    const metricDefs = [
      { key: 'matchRate', label: 'Match Rate', color: '#2dd4bf', get: (d) => d.metrics.matchRate },
      { key: 'duplicateRate', label: 'Duplicate Rate', color: '#a78bfa', get: (d) => d.metrics.duplicateRate },
      { key: 'qualityScore', label: 'Quality Score', color: '#f2b84b', get: (d) => d.metrics.qualityScore },
      { key: 'missingPct', label: 'Missing %', color: '#f2545b', get: (d) => (d.metrics.total ? (d.metrics.missing / d.metrics.total) * 100 : 0) },
    ];
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="cmp-chart-svg" style={{ width: '100%', height: 'auto' }}>
        {[0.25, 0.5, 0.75].map((f) => {
          const y = padT + f * innerH;
          return <line key={f} x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--card-border)" strokeWidth="1" strokeDasharray="3,4" />;
        })}
        {metricDefs.map((m) => {
          const values = list.map(m.get);
          const min = Math.min(...values, 0);
          const max = Math.max(...values, 100);
          const span = max - min || 1;
          const points = values.map((v, i) => [xFor(i), padT + (1 - (v - min) / span) * innerH]);
          const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          return (
            <g key={m.key}>
              <path d={d} fill="none" stroke={m.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.92" />
              {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={m.color} />)}
            </g>
          );
        })}
        {list.map((d, i) => (
          <text key={d.version} x={xFor(i)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--muted)">Day {d.version}</text>
        ))}
      </svg>
    );
  };

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
    const { report, day_summary, insights, beforeLabel, afterLabel, reportFile, keyColumns } = payload;
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

  // Columns available to pick as the key column: the intersection of the
  // "other side" file's columns and the newly chosen file's columns (a key
  // column has to exist in both to be usable), falling back to whichever
  // side we do have if the other hasn't been parsed yet.
  const keyColumnOptions = (() => {
    const otherSide = mode === 'new' ? uploadFile2Columns : seriesLatestColumns;
    const thisSide = uploadFileColumns;
    if (otherSide.length && thisSide.length) {
      const otherSet = new Set(otherSide);
      return thisSide.filter((col) => otherSet.has(col));
    }
    return thisSide.length ? thisSide : otherSide;
  })();

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
          <button className={`nav-item ${activeView === 'reconcile' ? 'active' : ''}`} onClick={() => setActiveView('reconcile')}>Reconcile</button>
          <button className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}>Stored Files</button>
          <button className={`nav-item ${activeView === 'reports' ? 'active' : ''}`} onClick={() => setActiveView('reports')}>Reports</button>
        </nav>
      </aside>

      <main className="main-area">
        <div className="content-container">
          <header className="app-header">
            <div className="header-brand">
              <div className="header-title">Reconciliation</div>
              <div className="header-subtitle">Upload files over time — every version is reconciled against the previous one</div>
            </div>
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
          </header>

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
                      <input ref={uploadInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => handleUploadFileChange(e.target.files[0] || null)} />
                      <button type="button" className="file-input-label" onClick={() => uploadInputRef.current?.click()}>
                        {uploadFile ? `📄 ${uploadFile.name}` : (mode === 'new' ? 'Choose Baseline File' : 'Choose File to Compare')}
                      </button>
                      {uploadFile && <div className="selected-file"><strong>{uploadFile.name}</strong><span>{Math.round(uploadFile.size / 1024)} KB</span></div>}
                    </div>

                    {mode === 'new' && (
                      <div className="upload-row">
                        <input ref={uploadInputRef2} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => handleUploadFile2Change(e.target.files[0] || null)} />
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
                          {keyColumnOptions.length > 0 ? (
                            <select
                              className="search-input"
                              value={uploadKeyCol}
                              onChange={(e) => setUploadKeyCol(e.target.value)}
                              style={{ flex: 1 }}
                            >
                              <option value="">Auto-detect</option>
                              {keyColumnOptions.map((col) => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="search-input"
                              placeholder={uploadFile ? 'Reading columns…' : 'Choose a file to see its columns'}
                              value={uploadKeyCol}
                              onChange={(e) => setUploadKeyCol(e.target.value)}
                              style={{ flex: 1 }}
                              disabled
                            />
                          )}
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

                  <div className="top-row" style={{ marginTop: 22 }}>
                    <h3 style={{ margin: 0 }}>Day-by-Day Comparison</h3>
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
                    const verdict = avgQuality >= 90 ? { label: 'Excellent', color: '#16a34a' }
                      : avgQuality >= 75 ? { label: 'Good', color: '#65a30d' }
                      : avgQuality >= 55 ? { label: 'Fair', color: '#d97706' }
                      : { label: 'Needs Attention', color: '#dc2626' };
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
                          <span className="cmp-verdict-pill" style={{ background: verdict.color }}>{verdict.label}</span>
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
                          <div className="cmp-legend">
                            <span className="cmp-legend-item"><span className="cmp-legend-dot" style={{ background: '#2dd4bf' }} />Match Rate</span>
                            <span className="cmp-legend-item"><span className="cmp-legend-dot" style={{ background: '#a78bfa' }} />Duplicate Rate</span>
                            <span className="cmp-legend-item"><span className="cmp-legend-dot" style={{ background: '#f2b84b' }} />Quality Score</span>
                            <span className="cmp-legend-item"><span className="cmp-legend-dot" style={{ background: '#f2545b' }} />Missing %</span>
                          </div>
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

      {/* ── EDA Report modal — opened from the day-by-day scoreboard above ── */}
      {edaDay !== null && activeSeries && versionReports[edaDay] && (() => {
        const payload = versionReports[edaDay];
        const metrics = computeRunMetrics(payload.report);
        const versionMeta = (activeSeries.series.versions || []).find((vv) => vv.version === edaDay);
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
                <button type="button" className="secondary" onClick={() => setEdaDay(null)}>✕ Close</button>
              </div>

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
              ) : <p className="muted">No narrative available for this day.</p>}

              {payload.insights?.top_columns?.length ? (
                <div style={{ marginTop: 16 }}>
                  <div className="rf-title">Most frequently changed fields</div>
                  {payload.insights.top_columns.map((c) => (
                    <div key={c.column} className="rf-row">
                      <span className="rf-name">{c.column}</span>
                      <span className="rf-track">
                        <span
                          className="rf-fill"
                          style={{ width: `${Math.min(100, (c.changes / payload.insights.top_columns[0].changes) * 100)}%` }}
                        />
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

      <div className="toasts">
        {toasts.map((toast) => <div key={toast.id} className="toast">{toast.message}</div>)}
      </div>
    </div>
  );
}

export default App;