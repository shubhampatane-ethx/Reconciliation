import { useEffect, useRef, useState, Fragment } from 'react';
import axios from 'axios';

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

function App() {
  // ── General UI ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState('reconcile');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);

  // ── Stored files & reports ───────────────────────────────────────────────
  const [storedFiles, setStoredFiles] = useState([]);
  const [reports, setReports] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const directUploadRef = useRef(null);

  // ── Unified comparison (series-driven) ─────────────────────────────────────
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeries, setActiveSeries] = useState(null);      // { series, timeline }
  const [mode, setMode] = useState('new');                     // 'new' | 'series'
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [addingVersion, setAddingVersion] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);  // payload for results area
  const [versionReports, setVersionReports] = useState({});    // version → payload cache

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
  const fetchStoredFiles = async () => {
    const response = await axios.get(`${API_BASE}/api/stored-files`);
    setStoredFiles(response.data.files || []);
  };

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
      const res = await axios.get(`${API_BASE}/api/series/${seriesId}`);
      const seriesData = res.data.series;
      setActiveSeries(res.data);
      setMode('series');
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
      await Promise.all([fetchStoredFiles(), fetchReports()]);
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
      await axios.post(`${API_BASE}/api/series/${seriesId}/versions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await fetchSeriesList();
      await openSeries(seriesId);            // auto-selects the newly added version
      await Promise.all([fetchStoredFiles(), fetchReports()]);
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
      await fetchSeriesList();
      showToast('Comparison deleted');
    } catch {
      showToast('Could not delete comparison.');
    }
  };

  // ── Stored files & reports ──────────────────────────────────────────────────
  const uploadDirectFile = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      setUploadingFile(true);
      await axios.post(`${API_BASE}/api/stored-files/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await fetchStoredFiles();
      showToast(`"${file.name}" uploaded to Stored Files`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed.');
    } finally {
      setUploadingFile(false);
    }
  };

  const previewStoredFile = async (file) => {
    if (previewFile?.file_id === file.file_id) { setPreviewFile(null); return; }
    try {
      const response = await axios.get(`${API_BASE}/api/file-chunks/${file.file_id}`);
      const chunks = response.data.chunks || [];
      const rows = chunks.map((chunk) => {
        const record = {};
        (chunk.text || '').trim().split('\n').forEach((line) => {
          const idx = line.indexOf(': ');
          if (idx !== -1) record[line.slice(0, idx).trim()] = line.slice(idx + 2).trim();
        });
        return record;
      });
      const columns = rows.length ? Object.keys(rows[0]) : [];
      setPreviewFile({ file_id: file.file_id, filename: file.filename, columns, rows, total: rows.length });
      showToast(`Previewing "${file.filename}"`);
    } catch {
      showToast('Could not load file preview.');
    }
  };

  const deleteStoredFile = async (file) => {
    if (!window.confirm(`Delete stored file "${file.filename}"?`)) return;
    try {
      await axios.delete(`${API_BASE}/api/stored-files/${file.file_id}`);
      setStoredFiles((items) => items.filter((item) => item.file_id !== file.file_id));
      if (previewFile?.file_id === file.file_id) setPreviewFile(null);
      showToast('Stored file deleted');
    } catch {
      showToast('Could not delete stored file.');
    }
  };

  const deleteAllStoredFiles = async () => {
    if (!storedFiles.length) { showToast('No stored files to delete.'); return; }
    if (!window.confirm(`Delete ALL ${storedFiles.length} stored files? This cannot be undone.`)) return;
    try {
      const res = await axios.delete(`${API_BASE}/api/stored-files`);
      setStoredFiles([]);
      setPreviewFile(null);
      showToast(`Deleted ${res.data.count} stored file${res.data.count !== 1 ? 's' : ''}`);
    } catch {
      showToast('Could not delete all stored files.');
    }
  };

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

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    applyTheme(localStorage.getItem('cr_theme') || 'dark');
    fetchStoredFiles().catch(() => {});
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
              {insights.clusters?.length > 0 && (
                <div className="insights-clusters">
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Detected patterns (grouped by meaning, not exact text):</span>
                  <div className="cluster-chips">
                    {insights.clusters.map((c, i) => (
                      <span key={i} className="cluster-chip" title={c.example}>{c.label} × {c.count}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {day_summary?.length ? (
            <>
              <div className="day-wise-viz">
                <DayWisePieChart segments={[
                  { label: 'Deleted', value: day_summary.reduce((sum, d) => sum + (d.missing_in_target || 0), 0), color: '#ef4444' },
                  { label: 'Added', value: day_summary.reduce((sum, d) => sum + (d.missing_in_source || 0), 0), color: '#22c55e' },
                  { label: 'Duplicates', value: day_summary.reduce((sum, d) => sum + (d.duplicates_source || 0) + (d.duplicates_target || 0), 0), color: '#f59e0b' },
                  { label: 'Value Changes', value: day_summary.reduce((sum, d) => sum + (d.mismatches || 0), 0), color: '#3b82f6' },
                  { label: 'Format Issues', value: day_summary.reduce((sum, d) => sum + (d.format_inconsistencies || 0), 0), color: '#a855f7' },
                ]} />
              </div>
              <div className="day-table">
                <div className="day-row header">
                  {['Date', beforeLabel, afterLabel, 'Deleted', 'Added', 'Duplicates', 'Value Changes', 'Format'].map((item, i) => <strong key={`${item}-${i}`}>{item}</strong>)}
                </div>
                {day_summary.map((day) => (
                  <div key={day.date} className="day-row">
                    <span>{day.date}</span>
                    <span>{day.source_records}</span>
                    <span>{day.target_records}</span>
                    <span>{day.missing_in_target}</span>
                    <span>{day.missing_in_source}</span>
                    <span>{(day.duplicates_source || 0) + (day.duplicates_target || 0)}</span>
                    <span>{day.mismatches}</span>
                    <span>{day.format_inconsistencies}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="muted">No shared date column was found, so day-wise grouping was skipped.</p>}
        </section>

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
      </>
    );
  };

  const latestLabel = activeSeries?.series?.versions?.slice(-1)[0]?.label;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <img src="/favicon.svg" alt="Consistency logo" style={{ height: 36 }} />
          <div className="brand-copy">
            <span className="brand-name">Consistency Reconciliation</span>
          </div>
        </div>
        <nav className="nav">
          <button className={`nav-item ${activeView === 'reconcile' ? 'active' : ''}`} onClick={() => setActiveView('reconcile')}>Dashboard</button>
          <button className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}>Files History</button>
          <button className={`nav-item ${activeView === 'reports' ? 'active' : ''}`} onClick={() => setActiveView('reports')}>Reports</button>
          <button className={`nav-item ${activeView === 'ai' ? 'active' : ''}`} onClick={() => setActiveView('Ai Assistance')}>AI Assistance</button>
        </nav>
      </aside>

      <main className="main-area">
        <div className="content-container">
          <header className="app-header">
            <div className="header-brand">
              <div className="header-title">Consistency Reconciliation</div>
              <div className="header-subtitle">Upload files over time — every version is reconciled against the previous one</div>
            </div>
            <div className="theme-anchor">
              <button id="cr-avatar" className={`avatar ${themeMenuOpen ? 'open' : ''}`} onClick={() => setThemeMenuOpen((open) => !open)}>CR</button>
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
            <section className="content-card result-section">
              <div className="top-row">
                <h2>Stored Files</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="search-input" placeholder="Search files..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                  <input ref={directUploadRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => uploadDirectFile(e.target.files[0])} />
                  <button type="button" onClick={() => directUploadRef.current?.click()} disabled={uploadingFile}>
                    {uploadingFile ? 'Uploading…' : '+ Upload File'}
                  </button>
                  <button type="button" className="danger" onClick={deleteAllStoredFiles} disabled={!storedFiles.length}>Delete All</button>
                </div>
              </div>

              {storedFiles.filter((f) => f.filename.toLowerCase().includes(filterText.toLowerCase())).length === 0 && (
                <p className="muted">No files stored yet. Upload a file above or run a reconciliation.</p>
              )}

              <div className="stored-files-list">
                {storedFiles.filter((f) => f.filename.toLowerCase().includes(filterText.toLowerCase())).map((file) => {
                  const isOpen = previewFile?.file_id === file.file_id;
                  return (
                    <Fragment key={file.file_id}>
                      <div className={`stored-file-row ${isOpen ? 'active' : ''}`}>
                        <div className="stored-file-info">
                          <span className="file-icon">📄</span>
                          <div>
                            <div className="file-name">{file.filename}</div>
                            <div className="file-meta">{file.file_type} · {file.chunk_count} rows</div>
                          </div>
                        </div>
                        <div className="file-card-actions">
                          <button type="button" className="secondary" onClick={() => previewStoredFile(file)}>
                            {isOpen ? 'Close Preview' : 'Preview'}
                          </button>
                          <button type="button" className="danger" onClick={() => deleteStoredFile(file)}>Delete</button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="inline-preview">
                          <div className="top-row" style={{ marginBottom: 8 }}>
                            <h3 style={{ margin: 0 }}>📄 {previewFile.filename} <span className="pill">{previewFile.total} rows</span></h3>
                          </div>
                          <div className="data-table-wrap">
                            <table className="data-table">
                              <thead>
                                <tr>{previewFile.columns.map((col) => <th key={col}>{col}</th>)}</tr>
                              </thead>
                              <tbody>
                                {previewFile.rows.slice(0, 200).map((row, idx) => (
                                  <tr key={idx}>
                                    {previewFile.columns.map((col) => <td key={col}>{String(row[col] ?? '')}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {previewFile.total > 200 && <p className="muted">Showing first 200 of {previewFile.total} rows.</p>}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </section>
          )}

          {activeView === 'reports' && (
            <section className="content-card result-section">
              <div className="top-row">
                <h2>Saved Excel Reports</h2>
                <button type="button" className="secondary" onClick={fetchReports}>↻ Refresh</button>
              </div>
              {!reports.length && <p className="muted">No reports saved yet. Run a reconciliation to generate one.</p>}
              <div className="reports-list">
                {reports.map((item) => {
                  const { label, timestamp } = formatReportName(item.filename);
                  return (
                    <div key={item.filename} className="report-row">
                      <div className="report-info">
                        <span className="file-icon">📊</span>
                        <div>
                          <div className="file-name">{label}</div>
                          <div className="file-meta">{timestamp}</div>
                        </div>
                      </div>
                      <div className="file-card-actions">
                        <button type="button" onClick={() => downloadReport(item.filename)}>⬇ Download</button>
                        <button type="button" className="danger" onClick={() => deleteReport(item.filename)}>Delete</button>
                      </div>
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
    </div>
  );
}

export default App;