import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const SchemaMappingModal = ({
  isOpen,
  onClose,
  sourceFileName,
  targetFileName,
  sourceColumns = [],
  targetColumns = [],
  onConfirmReconcile,
  isReconciling = false,
  apiBase = 'http://127.0.0.1:5000',
  sourceFileObj = null,
  targetFileObj = null,
}) => {
  // ── Mode Switcher State ───────────────────────────────────────────────────
  // Mode 1: HEADER_COLUMN | Mode 2: ROW_INDEX
  const [mappingMode, setMappingMode] = useState('HEADER_COLUMN');

  // ── Header / Column Mode State ────────────────────────────────────────────
  const [sourceKey, setSourceKey] = useState('');
  const [targetKey, setTargetKey] = useState('');
  const [columnMap, setColumnMap] = useState({}); // { [sourceCol]: targetCol }
  const [analysisData, setAnalysisData] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [selectedSignalCol, setSelectedSignalCol] = useState(null);

  // ── Row-to-Row Mode State ──────────────────────────────────────────────────
  const [rowMappings, setRowMappings] = useState([]); // [{ source_index: 0, target_index: 7 }]
  const [srcPreview, setSrcPreview] = useState(null);
  const [tgtPreview, setTgtPreview] = useState(null);
  const [srcPage, setSrcPage] = useState(1);
  const [tgtPage, setTgtPage] = useState(1);
  const [srcSearch, setSrcSearch] = useState('');
  const [tgtSearch, setTgtSearch] = useState('');
  const [loadingRowPreview, setLoadingRowPreview] = useState(false);

  // Input fields for Custom Index Pairing
  const [customSrcIdx, setCustomSrcIdx] = useState('0');
  const [customTgtIdx, setCustomTgtIdx] = useState('0');

  // Auto-Match Row Lookup State
  const [autoMatchReport, setAutoMatchReport] = useState(null);
  const [loadingAutoMatch, setLoadingAutoMatch] = useState(false);
  const [srcMatchNameCol, setSrcMatchNameCol] = useState('');
  const [tgtMatchNameCol, setTgtMatchNameCol] = useState('');
  const [srcMatchCityCol, setSrcMatchCityCol] = useState('');
  const [tgtMatchCityCol, setTgtMatchCityCol] = useState('');

  // ── Calculation Amount Column State ────────────────────────────────────────
  const AMOUNT_KEYWORDS = ['amount', 'amt', 'income', 'revenue', 'value', 'total', 'price', 'sum', 'debit', 'credit', 'balance'];
  const [sourceAmountCol, setSourceAmountCol] = useState('');
  const [targetAmountCol, setTargetAmountCol] = useState('');
  const [sourceAmountSum, setSourceAmountSum] = useState(null);
  const [targetAmountSum, setTargetAmountSum] = useState(null);
  const [loadingAmountSum, setLoadingAmountSum] = useState(false);

  const [localSourceCols, setLocalSourceCols] = useState(sourceColumns || []);
  const [localTargetCols, setLocalTargetCols] = useState(targetColumns || []);
  const [isFullscreen, setIsFullscreen] = useState(true);

  useEffect(() => {
    if (sourceColumns && sourceColumns.length) setLocalSourceCols(sourceColumns);
    if (targetColumns && targetColumns.length) setLocalTargetCols(targetColumns);
  }, [sourceColumns, targetColumns]);

  const effectiveSrcCols = localSourceCols.length ? localSourceCols : sourceColumns;
  const effectiveTgtCols = localTargetCols.length ? localTargetCols : targetColumns;

  // ── 1. Fetch Dynamic Analysis / Row Previews / Parse Columns on Modal Open ──
  useEffect(() => {
    if (!isOpen) return;

    // Parse source columns if missing
    if ((!effectiveSrcCols || !effectiveSrcCols.length) && sourceFileObj) {
      parseColumnsDirectly(sourceFileObj, 'source');
    }
    // Parse target columns if missing
    if ((!effectiveTgtCols || !effectiveTgtCols.length) && targetFileObj) {
      parseColumnsDirectly(targetFileObj, 'target');
    }

    // Reset or initial defaults for keys
    if (effectiveSrcCols.length > 0 && !sourceKey) {
      const defaultSrc = effectiveSrcCols.find(c => /id|number|code|key|no/i.test(c)) || effectiveSrcCols[0];
      setSourceKey(defaultSrc);
    }
    if (effectiveTgtCols.length > 0 && !targetKey) {
      const defaultTgt = effectiveTgtCols.find(c => /id|number|code|key|no/i.test(c)) || effectiveTgtCols[0];
      setTargetKey(defaultTgt);
    }

    // Initialize clean unmapped state on open (Auto-Map runs only when user clicks AI Auto-Map)
    initializeEmptyColumnMap(effectiveSrcCols);

    // Fetch dynamic 8-signal schema analysis in background for match scores
    if (sourceFileObj && targetFileObj) {
      fetchSchemaAnalysis(sourceFileObj, targetFileObj);
    }

    // Fetch Row Previews for Row Mode
    if (sourceFileObj && targetFileObj) {
      fetchRowPreviews(sourceFileObj, targetFileObj, 1, 1, '', '');
    }
  }, [isOpen, sourceFileObj, targetFileObj, sourceColumns, targetColumns]);

  // ── Auto-detect amount columns when columns are available ──────────────
  useEffect(() => {
    if (effectiveSrcCols.length && !sourceAmountCol) {
      const detected = effectiveSrcCols.find(c => AMOUNT_KEYWORDS.some(kw => c.toLowerCase().includes(kw)));
      if (detected) setSourceAmountCol(detected);
    }
    if (effectiveTgtCols.length && !targetAmountCol) {
      const detected = effectiveTgtCols.find(c => AMOUNT_KEYWORDS.some(kw => c.toLowerCase().includes(kw)));
      if (detected) setTargetAmountCol(detected);
    }
  }, [effectiveSrcCols, effectiveTgtCols]);

  // ── Compute live sum preview when amount columns or files change ───────
  const computeSumPreview = useCallback(async () => {
    if (!sourceFileObj && !targetFileObj) return;
    setLoadingAmountSum(true);
    try {
      if (sourceFileObj && sourceAmountCol) {
        const fd = new FormData();
        fd.append('file', sourceFileObj);
        fd.append('column', sourceAmountCol);
        const res = await axios.post(`${apiBase}/api/mapping/column-sum`, fd);
        setSourceAmountSum(res.data?.sum ?? null);
      } else {
        setSourceAmountSum(null);
      }

      if (targetFileObj && targetAmountCol) {
        const fd = new FormData();
        fd.append('file', targetFileObj);
        fd.append('column', targetAmountCol);
        const res = await axios.post(`${apiBase}/api/mapping/column-sum`, fd);
        setTargetAmountSum(res.data?.sum ?? null);
      } else {
        setTargetAmountSum(null);
      }
    } catch {
      setSourceAmountSum(null);
      setTargetAmountSum(null);
    } finally {
      setLoadingAmountSum(false);
    }
  }, [sourceFileObj, targetFileObj, sourceAmountCol, targetAmountCol, apiBase]);

  useEffect(() => {
    if (isOpen && (sourceAmountCol || targetAmountCol)) {
      computeSumPreview();
    }
  }, [isOpen, sourceAmountCol, targetAmountCol, computeSumPreview]);

  const parseColumnsDirectly = async (file, type) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post(`${apiBase}/api/preview-columns`, fd);
      if (res.data?.columns?.length) {
        if (type === 'source') {
          setLocalSourceCols(res.data.columns);
          if (res.data.suggested_key) setSourceKey(res.data.suggested_key);
        } else {
          setLocalTargetCols(res.data.columns);
          if (res.data.suggested_key) setTargetKey(res.data.suggested_key);
        }
      }
    } catch (err) {
      console.warn(`Could not parse ${type} columns directly:`, err);
    }
  };

  // ── Helper: 5-Pass Smart Auto-Mapping Engine ──────────────────────────────
  const computeSmartAutoMap = (srcCols, tgtCols) => {
    if (!srcCols || !tgtCols || !srcCols.length || !tgtCols.length) return {};

    const cleanHeader = (header) => {
      if (!header) return '';
      let s = String(header).toLowerCase();
      // Strip common system/project/op-co prefixes
      s = s.replace(/^(site\d+_|src_|tgt_|source_|target_|ora_|db_|cjbs_|etairos_|airetech_|ats_|erp_|cust_|acc_)/i, '');
      // Strip common system/data suffixes
      s = s.replace(/(_original|_ora|_src|_tgt|_source|_target|_desc|_table|_file|_data|_info|_col|_val|_num)$/i, '');
      // Strip punctuation & non-alphanumeric
      return s.replace(/[^a-z0-9]/g, '');
    };

    const SYNONYM_GROUPS = [
      {
        key: 'PARTY_NUMBER',
        matches: ['partynumber', 'partyno', 'partyid', 'customerid', 'customerno', 'customernumber', 'accountno', 'accountnumber', 'custno', 'custid', 'clientno', 'clientid']
      },
      {
        key: 'PARTY_NAME',
        matches: ['entityname', 'partyname', 'customername', 'customer', 'company', 'name', 'client', 'vendor', 'entity', 'custname', 'clientname']
      },
      {
        key: 'ADDRESS1',
        matches: ['address1', 'street', 'addressline1', 'address', 'siteaddress', 'billtoaddress', 'shiptoaddress', 'addr1']
      },
      {
        key: 'ADDRESS2',
        matches: ['address2', 'street2', 'addressline2', 'suite', 'unit', 'addr2']
      },
      {
        key: 'CITY',
        matches: ['city', 'town', 'municipality']
      },
      {
        key: 'STATE',
        matches: ['state', 'province', 'region']
      },
      {
        key: 'ZIP',
        matches: ['zip', 'zipcode', 'postal', 'postalcode', 'pincode', 'postcode']
      },
      {
        key: 'PHONE',
        matches: ['phone', 'phonenumber', 'mobile', 'telephone', 'tel', 'cell', 'phone1', 'phone2']
      },
      {
        key: 'EMAIL',
        matches: ['email', 'emailaddress', 'mail', 'email1']
      },
      {
        key: 'PAYMENT_TERMS',
        matches: ['paymentterm', 'paymentterms', 'terms', 'payterm', 'term']
      },
      {
        key: 'TAX_ID',
        matches: ['taxidentifier', 'taxid', 'vat', 'ein', 'ssn', 'taxno']
      },
      {
        key: 'CONTACT',
        matches: ['contactperson', 'contact', 'contactname']
      },
      {
        key: 'INVOICE_NUM',
        matches: ['invoicenumber', 'invoiceno', 'docnum', 'sodocnum', 'document', 'doccontnum', 'invno', 'invoice']
      },
      {
        key: 'AMOUNT',
        matches: ['amount', 'amt', 'currentamt', 'origamt', 'revlineamt', 'price', 'total', 'balance', 'val', 'value']
      },
      {
        key: 'DATE',
        matches: ['date', 'entrydate', 'duedate', 'discduedate', 'invdate', 'invoicedate', 'transdate']
      }
    ];

    const getSynonymConcept = (header) => {
      const cleaned = cleanHeader(header);
      for (const group of SYNONYM_GROUPS) {
        if (group.matches.some(m => cleaned.includes(m) || m.includes(cleaned))) {
          return group.key;
        }
      }
      return null;
    };

    const initialMap = {};
    const usedTargetCols = new Set();

    srcCols.forEach(sc => {
      let bestMatch = null;
      const scClean = cleanHeader(sc);
      const scExactClean = sc.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Pass 1: Exact string match (case insensitive)
      bestMatch = tgtCols.find(tc => !usedTargetCols.has(tc) && tc.toLowerCase() === sc.toLowerCase());

      // Pass 2: Clean Alphanumeric Exact match
      if (!bestMatch) {
        bestMatch = tgtCols.find(tc => !usedTargetCols.has(tc) && tc.toLowerCase().replace(/[^a-z0-9]/g, '') === scExactClean);
      }

      // Pass 3: Suffix / Prefix Cleaned Header Stem match
      if (!bestMatch && scClean) {
        bestMatch = tgtCols.find(tc => !usedTargetCols.has(tc) && cleanHeader(tc) === scClean);
      }

      // Pass 4: Synonym Concept Match
      if (!bestMatch) {
        const scConcept = getSynonymConcept(sc);
        if (scConcept) {
          bestMatch = tgtCols.find(tc => !usedTargetCols.has(tc) && getSynonymConcept(tc) === scConcept);
        }
      }

      // Pass 5: Substring / Token Overlap Match (for length >= 3)
      if (!bestMatch && scClean.length >= 3) {
        bestMatch = tgtCols.find(tc => {
          if (usedTargetCols.has(tc)) return false;
          const tcClean = cleanHeader(tc);
          return tcClean.length >= 3 && (scClean.includes(tcClean) || tcClean.includes(scClean));
        });
      }

      if (bestMatch) {
        initialMap[sc] = bestMatch;
        usedTargetCols.add(bestMatch);
      } else {
        initialMap[sc] = '__ignore__';
      }
    });

    return initialMap;
  };

  const updateKeySelectionsFromMap = (map, srcCols, tgtCols) => {
    let currentSrcKey = sourceKey;
    if (!currentSrcKey || !srcCols.includes(currentSrcKey)) {
      currentSrcKey = srcCols.find(c => /id|number|code|key|no/i.test(c)) || srcCols[0] || '';
      if (currentSrcKey) setSourceKey(currentSrcKey);
    }
    if (currentSrcKey && map[currentSrcKey] && map[currentSrcKey] !== '__ignore__') {
      setTargetKey(map[currentSrcKey]);
    } else if (!targetKey || !tgtCols.includes(targetKey)) {
      const defaultTgt = tgtCols.find(c => /id|number|code|key|no/i.test(c)) || tgtCols[0] || '';
      if (defaultTgt) setTargetKey(defaultTgt);
    }
  };

  const initializeEmptyColumnMap = (srcCols) => {
    const map = {};
    (srcCols || []).forEach(sc => {
      map[sc] = '__ignore__';
    });
    setColumnMap(map);
  };

  // ── API: Fetch 8-Signal Dynamic Schema Analysis ───────────────────────────
  const fetchSchemaAnalysis = async (srcFile, tgtFile) => {
    setLoadingAnalysis(true);
    try {
      const fd = new FormData();
      fd.append('source_file', srcFile);
      fd.append('target_file', tgtFile);
      const res = await axios.post(`${apiBase}/api/mapping/analyze-schema`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setAnalysisData(res.data);

      if (res.data.suggested_source_key && !sourceKey) setSourceKey(res.data.suggested_source_key);
      if (res.data.suggested_target_key && !targetKey) setTargetKey(res.data.suggested_target_key);
    } catch (err) {
      console.warn('Could not fetch schema analysis:', err);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // ── API: Fetch Paginated Row Previews ─────────────────────────────────────
  const fetchRowPreviews = async (srcFile, tgtFile, sP, tP, sQ, tQ) => {
    setLoadingRowPreview(true);
    try {
      const fd1 = new FormData();
      fd1.append('file', srcFile);
      fd1.append('prefix', 'SRC');
      fd1.append('page', sP);
      fd1.append('page_size', 10);
      fd1.append('search', sQ);

      const fd2 = new FormData();
      fd2.append('file', tgtFile);
      fd2.append('prefix', 'TGT');
      fd2.append('page', tP);
      fd2.append('page_size', 10);
      fd2.append('search', tQ);

      const [res1, res2] = await Promise.all([
        axios.post(`${apiBase}/api/mapping/row-preview`, fd1),
        axios.post(`${apiBase}/api/mapping/row-preview`, fd2),
      ]);

      setSrcPreview(res1.data);
      setTgtPreview(res2.data);
    } catch (err) {
      console.warn('Could not fetch row previews:', err);
    } finally {
      setLoadingRowPreview(false);
    }
  };

  if (!isOpen) return null;

  // ── Key & Header Mode Handlers ───────────────────────────────────────────
  const handleSourceKeySelect = (newSrcKey) => {
    setSourceKey(newSrcKey);
    if (columnMap[newSrcKey] && columnMap[newSrcKey] !== '__ignore__') {
      setTargetKey(columnMap[newSrcKey]);
    } else if (targetKey && targetKey !== '__ignore__') {
      setColumnMap(prev => ({ ...prev, [newSrcKey]: targetKey }));
    }
  };

  const handleTargetKeySelect = (newTgtKey) => {
    setTargetKey(newTgtKey);
    if (sourceKey) {
      setColumnMap(prev => ({ ...prev, [sourceKey]: newTgtKey }));
    }
  };

  const handleMappingChange = (srcCol, newTgtCol) => {
    setColumnMap(prev => ({ ...prev, [srcCol]: newTgtCol }));
    if (srcCol === sourceKey) {
      setTargetKey(newTgtCol !== '__ignore__' ? newTgtCol : '');
    }
  };

  const handleAiAutoMap = () => {
    const smartMap = computeSmartAutoMap(effectiveSrcCols, effectiveTgtCols);
    let finalMap = smartMap;
    if (analysisData?.recommended_mappings) {
      const recMap = {};
      analysisData.recommended_mappings.forEach(m => {
        if (m.recommended_target && m.recommended_target !== '__ignore__') {
          recMap[m.source_column] = m.recommended_target;
        }
      });
      const mergedMap = {};
      effectiveSrcCols.forEach(sc => {
        if (recMap[sc] && recMap[sc] !== '__ignore__') {
          mergedMap[sc] = recMap[sc];
        } else {
          mergedMap[sc] = smartMap[sc] || '__ignore__';
        }
      });
      finalMap = mergedMap;
    }
    setColumnMap(finalMap);
    updateKeySelectionsFromMap(finalMap, effectiveSrcCols, effectiveTgtCols);
  };

  const handleResetMapping = () => {
    const resetMap = {};
    effectiveSrcCols.forEach(sc => {
      resetMap[sc] = '__ignore__';
    });
    setColumnMap(resetMap);
  };

  // ── Row Mode Handlers ────────────────────────────────────────────────────
  const handleAddCustomRowPair = () => {
    const sIdx = parseInt(customSrcIdx, 10);
    const tIdx = parseInt(customTgtIdx, 10);

    if (isNaN(sIdx) || isNaN(tIdx) || sIdx < 0 || tIdx < 0) {
      alert('Please enter valid non-negative integer indexes for Source and Target.');
      return;
    }

    // Check duplicate
    if (rowMappings.some(r => r.source_index === sIdx)) {
      alert(`Source Index ${sIdx} is already mapped!`);
      return;
    }
    if (rowMappings.some(r => r.target_index === tIdx)) {
      alert(`Target Index ${tIdx} is already mapped!`);
      return;
    }

    setRowMappings(prev => [...prev, { source_index: sIdx, target_index: tIdx }]);
  };

  const handleRemoveRowPair = (sIdx) => {
    setRowMappings(prev => prev.filter(r => r.source_index !== sIdx));
  };

  const handleSameIndexMapping = () => {
    const maxRows = Math.min(srcPreview?.total_records || 10, tgtPreview?.total_records || 10);
    const samePairs = [];
    for (let i = 0; i < maxRows; i++) {
      samePairs.push({ source_index: i, target_index: i });
    }
    setRowMappings(samePairs);
  };

  const handleRunAutoMatchRows = async () => {
    if (!sourceFileObj || !targetFileObj) {
      alert('Row Auto-Match requires both Source and Target files.');
      return;
    }
    setLoadingAutoMatch(true);
    try {
      const fd = new FormData();
      fd.append('source_file', sourceFileObj);
      fd.append('target_file', targetFileObj);
      if (srcMatchNameCol) fd.append('src_name_col', srcMatchNameCol);
      if (tgtMatchNameCol) fd.append('tgt_name_col', tgtMatchNameCol);
      if (srcMatchCityCol) fd.append('src_city_col', srcMatchCityCol);
      if (tgtMatchCityCol) fd.append('tgt_city_col', tgtMatchCityCol);

      const res = await axios.post(`${apiBase}/api/mapping/auto-match-rows`, fd);
      if (res.data?.generated_pairs) {
        setRowMappings(res.data.generated_pairs);
        setAutoMatchReport(res.data);
      }
    } catch (err) {
      console.error('Auto match failed:', err);
      alert('Could not execute Row Auto-Match: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingAutoMatch(false);
    }
  };

  // ── Confirm Reconcile Button Handler ──────────────────────────────────────
  const handleConfirm = () => {
    if (mappingMode === 'HEADER_COLUMN') {
      if (!sourceKey) {
        alert('Please select a Source Key Column for Header/Column mode.');
        return;
      }
      const mappedTgtKey = columnMap[sourceKey];
      const effectiveTgtKey = (mappedTgtKey && mappedTgtKey !== '__ignore__') ? mappedTgtKey : (targetKey || sourceKey);
      onConfirmReconcile({
        mapping_mode: 'HEADER_COLUMN',
        source_key: sourceKey,
        target_key: effectiveTgtKey,
        column_map: columnMap,
        amount_source_col: sourceAmountCol || undefined,
        amount_target_col: targetAmountCol || undefined,
      });
    } else {
      if (!rowMappings.length) {
        alert('Please map at least one Source Index → Target Index pair for Row-to-Row mode.');
        return;
      }
      onConfirmReconcile({
        mapping_mode: 'ROW_INDEX',
        row_mappings: rowMappings,
      });
    }
  };

  // Get score category style badge
  const getBadgeStyle = (category, confidence) => {
    if (category === 'VERY HIGH' || confidence >= 0.85) {
      return { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' };
    }
    if (category === 'HIGH' || confidence >= 0.70) {
      return { background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' };
    }
    if (category === 'NEEDS REVIEW' || confidence >= 0.50) {
      return { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' };
    }
    return { background: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.3)' };
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
        background: 'rgba(2, 6, 23, 0.88)',
        backdropFilter: 'blur(12px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isFullscreen ? 0 : 12,
      }}
    >
      <div
        className="content-card"
        style={{
          width: isFullscreen ? '100vw' : '96vw',
          maxWidth: isFullscreen ? '100vw' : 1440,
          height: isFullscreen ? '100vh' : '95vh',
          maxHeight: isFullscreen ? '100vh' : '98vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: isFullscreen ? 'none' : '1px solid var(--card-border)',
          borderRadius: isFullscreen ? 0 : 16,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8)',
          padding: isFullscreen ? '16px 24px' : '18px 24px',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Modal Title Bar ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--card-border)', paddingBottom: 10, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>⚙️</span> Enterprise Schema & Row Mapping Engine
            </h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
              Dataset-Agnostic Reconciliation — Select your mapping mode below.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit Fullscreen" : "Full Screen View"}
              style={{ padding: '6px 12px', fontSize: '0.84rem', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span>{isFullscreen ? '🗗 Standard View' : '⛶ Fullscreen View'}</span>
            </button>
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
        </div>

        {/* ── MODE SELECTOR TAB BAR ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setMappingMode('HEADER_COLUMN')}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              border: mappingMode === 'HEADER_COLUMN' ? '2px solid var(--primary)' : '1px solid var(--card-border)',
              background: mappingMode === 'HEADER_COLUMN' ? 'rgba(6, 182, 212, 0.12)' : 'rgba(0,0,0,0.2)',
              color: mappingMode === 'HEADER_COLUMN' ? 'var(--primary)' : 'var(--muted)',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: '1.05rem' }}>🧬 1. HEADER / COLUMN MAPPING</span>
            <span style={{ fontSize: '0.74rem', fontWeight: 400 }}>
              Schema & Primary Key matching. Strictly NO Row Indexing.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMappingMode('ROW_INDEX')}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              border: mappingMode === 'ROW_INDEX' ? '2px solid #a855f7' : '1px solid var(--card-border)',
              background: mappingMode === 'ROW_INDEX' ? 'rgba(168, 85, 247, 0.12)' : 'rgba(0,0,0,0.2)',
              color: mappingMode === 'ROW_INDEX' ? '#a855f7' : 'var(--muted)',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: '1.05rem' }}>🔢 2. ROW-TO-ROW MAPPING WITH INDEXING</span>
            <span style={{ fontSize: '0.74rem', fontWeight: 400 }}>
              Explicit Source Index → Target Index pairing. Indexing lives ONLY here.
            </span>
          </button>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* ── MODE 1: HEADER / COLUMN MAPPING ──────────────────────────────── */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {mappingMode === 'HEADER_COLUMN' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Unified 4-Column Controls Bar: Primary Key & Amount Selectors */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12, background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--card-border)', flexShrink: 0 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: 4, color: 'var(--text)' }}>
                  🔑 Source Key Column <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="search-input"
                  value={sourceKey}
                  onChange={(e) => handleSourceKeySelect(e.target.value)}
                  style={{ width: '100%', fontSize: '0.86rem', padding: '5px 8px' }}
                >
                  {!effectiveSrcCols.length && <option value="">Loading source columns…</option>}
                  {effectiveSrcCols.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: 4, color: 'var(--text)' }}>
                  🔑 Target Key Column <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="search-input"
                  value={targetKey}
                  onChange={(e) => handleTargetKeySelect(e.target.value)}
                  style={{ width: '100%', fontSize: '0.86rem', padding: '5px 8px' }}
                >
                  {!effectiveTgtCols.length && <option value="">Loading target columns…</option>}
                  {effectiveTgtCols.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: 4, color: 'var(--text)' }}>
                  💰 Source Amount <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                </label>
                <select
                  className="search-input"
                  value={sourceAmountCol}
                  onChange={(e) => { setSourceAmountCol(e.target.value); setSourceAmountSum(null); }}
                  style={{ width: '100%', fontSize: '0.86rem', padding: '5px 8px' }}
                >
                  <option value="">-- None --</option>
                  {effectiveSrcCols.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: 4, color: 'var(--text)' }}>
                  💰 Target Amount <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                </label>
                <select
                  className="search-input"
                  value={targetAmountCol}
                  onChange={(e) => { setTargetAmountCol(e.target.value); setTargetAmountSum(null); }}
                  style={{ width: '100%', fontSize: '0.86rem', padding: '5px 8px' }}
                >
                  <option value="">-- None --</option>
                  {effectiveTgtCols.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live Sum Preview */}
            {(sourceAmountCol || targetAmountCol) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12, flexShrink: 0 }}>
                {sourceAmountCol && (
                  <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 2 }}>Source Sum ({sourceAmountCol})</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {loadingAmountSum ? '...' : sourceAmountSum != null ? Number(sourceAmountSum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </div>
                  </div>
                )}
                {targetAmountCol && (
                  <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 2 }}>Target Sum ({targetAmountCol})</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a855f7' }}>
                      {loadingAmountSum ? '...' : targetAmountSum != null ? Number(targetAmountSum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </div>
                  </div>
                )}
                {sourceAmountCol && targetAmountCol && sourceAmountSum != null && targetAmountSum != null && (
                  <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 2 }}>Difference (Source − Target)</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f59e0b' }}>
                      {loadingAmountSum ? '...' : Number(sourceAmountSum - targetAmountSum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Column Mapping Table with Sticky Header & Custom Scrollbar */}
            <div className="custom-scrollbar" style={{ flex: 1, minHeight: 280, overflowY: 'auto', border: '1px solid var(--card-border)', borderRadius: 12, marginBottom: 12, background: 'rgba(0,0,0,0.2)' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a' }}>
                  <tr>
                    <th style={{ width: '28%', textAlign: 'left', padding: '10px 14px', background: '#0f172a' }}>Source Column</th>
                    <th style={{ width: '36%', textAlign: 'left', padding: '10px 14px', background: '#0f172a' }}>Target Column</th>
                    <th style={{ width: '24%', textAlign: 'left', padding: '10px 14px', background: '#0f172a' }}>8-Signal Match Score</th>
                    <th style={{ width: '12%', textAlign: 'center', padding: '10px 14px', background: '#0f172a' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {!effectiveSrcCols.length ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 20 }} className="muted">
                        Parsing column headers…
                      </td>
                    </tr>
                  ) : (
                    effectiveSrcCols.map(srcCol => {
                      const currentTgt = columnMap[srcCol] || '__ignore__';
                      const recObj = (analysisData?.recommended_mappings || []).find(r => r.source_column === srcCol);
                      let confidence = recObj?.confidence;
                      let category = recObj?.category;

                      if (confidence == null) {
                        if (currentTgt !== '__ignore__') {
                          const scClean = srcCol.toLowerCase().replace(/[^a-z0-9]/g, '');
                          const tcClean = currentTgt.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (scClean === tcClean || srcCol.toLowerCase() === currentTgt.toLowerCase()) {
                            confidence = 1.0;
                            category = 'PERFECT MATCH';
                          } else {
                            confidence = 0.95;
                            category = 'VERY HIGH';
                          }
                        } else {
                          confidence = 0.0;
                          category = 'UNMAPPED';
                        }
                      }
                      const signals = recObj?.signals;

                      const isKey = srcCol === sourceKey;
                      const badgeStyle = getBadgeStyle(category, confidence);

                      return (
                        <tr key={srcCol} style={{ background: isKey ? 'rgba(6, 182, 212, 0.05)' : undefined }}>
                          <td style={{ fontWeight: 600, fontSize: '0.88rem', padding: '8px 12px' }}>
                            {srcCol}
                            {isKey && (
                              <span className="pill" style={{ marginLeft: 6, fontSize: '0.7rem', background: 'rgba(6,182,212,0.2)', color: 'var(--primary)' }}>
                                Key
                              </span>
                            )}
                          </td>

                          <td style={{ padding: '6px 12px' }}>
                            <select
                              className="search-input"
                              value={currentTgt}
                              onChange={(e) => handleMappingChange(srcCol, e.target.value)}
                              style={{ width: '100%', fontSize: '0.88rem', padding: '4px 8px' }}
                            >
                              <option value="__ignore__">-- Ignore / Skip --</option>
                              {effectiveTgtCols.map(tc => (
                                <option key={tc} value={tc}>{tc}</option>
                              ))}
                            </select>
                          </td>

                          <td style={{ padding: '6px 12px' }}>
                            <span
                              className="status-badge"
                              style={{ ...badgeStyle, fontSize: '0.78rem', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}
                            >
                              {Math.round(confidence * 100)}% {category}
                            </span>
                          </td>

                          <td style={{ textAlign: 'center', padding: '6px 12px' }}>
                            {signals ? (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setSelectedSignalCol(selectedSignalCol === srcCol ? null : srcCol)}
                                style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: 4, cursor: 'pointer' }}
                              >
                                📊
                              </button>
                            ) : (
                              <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Explainable Signals Popover */}
            {selectedSignalCol && (
              <div style={{ background: 'rgba(0,0,0,0.4)', padding: 12, borderRadius: 10, border: '1px solid var(--primary)', marginBottom: 12, fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--primary)', marginBottom: 6 }}>
                  <span>Explanation Signals for `{selectedSignalCol}`</span>
                  <button type="button" onClick={() => setSelectedSignalCol(null)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                </div>
                {(() => {
                  const recObj = (analysisData?.recommended_mappings || []).find(r => r.source_column === selectedSignalCol);
                  if (!recObj?.signals) return <p className="muted">No signal breakdown available.</p>;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {Object.entries(recObj.signals).map(([sigKey, sigVal]) => (
                        <div key={sigKey} style={{ background: 'rgba(255,255,255,0.04)', padding: '4px 8px', borderRadius: 6 }}>
                          <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{sigKey.replace('_', ' ')}</div>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{Math.round(sigVal * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* ── MODE 2: ROW-TO-ROW MAPPING WITH INDEXING ─────────────────────── */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {mappingMode === 'ROW_INDEX' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Auto-Lookup Matching Controls (Primary Key + Tie-breaker) */}
            <div style={{ background: 'rgba(168, 85, 247, 0.08)', padding: 12, borderRadius: 12, border: '1px solid rgba(168, 85, 247, 0.25)', marginBottom: 12, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#c084fc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔍 Auto-Lookup Row Pairs (Name + City Composite Matching)
                </span>
                <button
                  type="button"
                  onClick={handleRunAutoMatchRows}
                  disabled={loadingAutoMatch}
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
                  }}
                >
                  {loadingAutoMatch ? '⏳ Running Auto-Lookup...' : '⚡ Run Auto-Lookup Matching'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Source Name Col (entity_name_ora)
                  </label>
                  <select
                    className="search-input"
                    value={srcMatchNameCol}
                    onChange={(e) => setSrcMatchNameCol(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem', padding: '4px 8px' }}
                  >
                    <option value="">Auto-Detect Column</option>
                    {effectiveSrcCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Target Name Col (PARTY_NAME)
                  </label>
                  <select
                    className="search-input"
                    value={tgtMatchNameCol}
                    onChange={(e) => setTgtMatchNameCol(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem', padding: '4px 8px' }}
                  >
                    <option value="">Auto-Detect Column</option>
                    {effectiveTgtCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Tie-Breaker Source City
                  </label>
                  <select
                    className="search-input"
                    value={srcMatchCityCol}
                    onChange={(e) => setSrcMatchCityCol(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem', padding: '4px 8px' }}
                  >
                    <option value="">Auto-Detect Column</option>
                    {effectiveSrcCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Tie-Breaker Target City
                  </label>
                  <select
                    className="search-input"
                    value={tgtMatchCityCol}
                    onChange={(e) => setTgtMatchCityCol(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem', padding: '4px 8px' }}
                  >
                    <option value="">Auto-Detect Column</option>
                    {effectiveTgtCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Custom Index Pair Controls */}
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 10, border: '1px solid var(--card-border)', marginBottom: 12, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text)' }}>
                  📌 Manual Index Pair Entry (1-based data row numbers)
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleSameIndexMapping}
                  style={{ padding: '3px 10px', fontSize: '0.76rem', cursor: 'pointer', borderColor: '#a855f7', color: '#a855f7' }}
                >
                  ⚡ Same Index Shortcut (1→1, 2→2...)
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Source Row Index
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="search-input"
                    value={customSrcIdx}
                    onChange={(e) => setCustomSrcIdx(e.target.value)}
                    style={{ width: '100%', fontSize: '0.86rem', padding: '5px 10px' }}
                    placeholder="e.g. 0"
                  />
                </div>

                <span style={{ fontWeight: 700, color: '#a855f7', fontSize: '1.2rem', marginTop: 14 }}>➔</span>

                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--muted)', marginBottom: 2 }}>
                    Target Row Index
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="search-input"
                    value={customTgtIdx}
                    onChange={(e) => setCustomTgtIdx(e.target.value)}
                    style={{ width: '100%', fontSize: '0.86rem', padding: '5px 10px' }}
                    placeholder="e.g. 7"
                  />
                </div>

                <button
                  type="button"
                  className="run-btn"
                  onClick={handleAddCustomRowPair}
                  style={{ marginTop: 14, padding: '6px 16px', fontSize: '0.84rem', background: '#a855f7', cursor: 'pointer' }}
                >
                  + Add Pair
                </button>
              </div>
            </div>

            {/* Confirmed Row Index Mappings List */}
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--card-border)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
                <span>Mapped Row Pairs ({rowMappings.length} Pair(s))</span>
                <span className="muted" style={{ fontWeight: 400 }}>
                  Internal record IDs (`SRC_x`, `TGT_y`) protect against positional shifts.
                </span>
              </div>

              {!rowMappings.length ? (
                <div style={{ textAlign: 'center', padding: 30 }} className="muted">
                  No row pairs mapped yet. Add custom pairs above or click "Same Index Mapping Shortcut".
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {rowMappings.map((pair) => (
                    <div
                      key={pair.source_index}
                      style={{
                        background: 'rgba(168, 85, 247, 0.1)',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)' }}>
                        Src [{pair.source_index}] ➔ Tgt [{pair.target_index}]
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRowPair(pair.source_index)}
                        style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem' }}
                        title="Remove pair"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-Match Report Detailed Breakdown Table */}
            {autoMatchReport && (
              <div style={{ flex: 1, minHeight: 180, overflowY: 'auto', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.3)', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.86rem', color: '#c084fc' }}>
                    📊 Row Lookup Match Report (1-Based Data Row Numbers)
                  </span>
                  <div style={{ display: 'flex', gap: 6, fontSize: '0.74rem' }}>
                    <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', padding: '2px 6px', borderRadius: 4 }}>
                      Name+City: {autoMatchReport.summary?.name_city_matches || 0}
                    </span>
                    <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', padding: '2px 6px', borderRadius: 4 }}>
                      Name Only: {autoMatchReport.summary?.name_only_matches || 0}
                    </span>
                    <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '2px 6px', borderRadius: 4 }}>
                      No Match: {autoMatchReport.summary?.no_matches || 0}
                    </span>
                  </div>
                </div>

                <table className="data-table" style={{ fontSize: '0.78rem' }}>
                  <thead>
                    <tr>
                      <th>Src Row #</th>
                      <th>Source Entity Name</th>
                      <th>City</th>
                      <th>Match Method</th>
                      <th>Target Row #(s)</th>
                      <th>Target Party Name</th>
                      <th>Target Party #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(autoMatchReport.report_rows || []).map((r, i) => (
                      <tr key={i} style={{ background: r.Match_Method === 'NO MATCH' ? 'rgba(239,68,68,0.06)' : undefined }}>
                        <td style={{ fontWeight: 600 }}>{r.Source_Row_Index}</td>
                        <td>{r.Source_Entity_Name}</td>
                        <td className="muted">{r.Source_City || '—'}</td>
                        <td>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: '0.72rem',
                              background: r.Match_Method.includes('Name+City') ? 'rgba(34,197,94,0.2)' : r.Match_Method === 'NO MATCH' ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)',
                              color: r.Match_Method.includes('Name+City') ? '#22c55e' : r.Match_Method === 'NO MATCH' ? '#ef4444' : '#3b82f6',
                            }}
                          >
                            {r.Match_Method}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: '#a855f7' }}>{r.Target_Row_Index}</td>
                        <td>{r.Target_PARTY_NAME}</td>
                        <td>{r.Target_PARTY_NUMBER}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Modal Footer Buttons ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--card-border)', paddingTop: 14, flexShrink: 0 }}>
          {mappingMode === 'HEADER_COLUMN' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="secondary" onClick={handleAiAutoMap} style={{ padding: '6px 12px', fontSize: '0.84rem', cursor: 'pointer' }}>
                🤖 AI Auto-Map
              </button>
              <button type="button" className="secondary" onClick={handleResetMapping} style={{ padding: '6px 12px', fontSize: '0.84rem', cursor: 'pointer' }}>
                Reset Mapping
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              Mapped: <strong>{rowMappings.length}</strong> pair(s)
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="run-btn"
              onClick={handleConfirm}
              disabled={isReconciling}
              style={{
                padding: '8px 22px',
                fontSize: '0.9rem',
                background: mappingMode === 'ROW_INDEX' ? 'linear-gradient(135deg, #a855f7, #7e22ce)' : 'linear-gradient(135deg, #10b981, #059669)',
                cursor: 'pointer',
              }}
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
