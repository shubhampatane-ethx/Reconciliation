# Vector Database & Semantic Analysis Architecture in Reconciliation App

This document details all the places in the reconciliation application codebase where **Vector Database (Vector DB)** structures, concepts, or algorithms are utilized, along with their business and technical purposes, and how they relate to the Postgres database baseline features.

---

## 1. Directory-Based Document Chunk Storage (FileSystem Vector DB)
* **Code Location**: [storage.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/storage.py) (lines 9–10, 50–95, 98–120, 121–134, 136–145)
* **Purpose**: Serves as a persistent document repository for uploaded files.
* **Mechanism**:
  * **Text Extraction**: When a file is uploaded, the app uses `_extract_text_from_dataframe()` to turn every row of tabular data into a structured string of column-value pairs (e.g., `ColumnName: Value; ...`).
  * **Document Chunking**: The resulting text strings are chunked into documents of at most 800 characters using `_chunk_texts()`.
  * **Storage**: These chunks are persisted as JSON files inside the `vector_store/` directory (under the file name `{file_id}.json`).
  * **Future Scaling**: The comments note that this architecture is designed to be easily swapped with a hosted vector database client (e.g., `chromadb.Client()`) when scaling up to support advanced search or cross-file semantic indexing.

---

## 2. In-Memory Fuzzy/Vector Key Matching
* **Code Location**: [fuzzy_match.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/fuzzy_match.py) (lines 18–33, 48–60, 61–138) & called in [app.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/app.py) (lines 243–245, 247–271)
* **Purpose**: Identifies records that were renamed or had typos in their primary keys across versions, avoiding false-positive "Deleted + Added" flags.
* **Mechanism**:
  * **Key Vectorization**: Leftover unmatched keys are converted into vectors using scikit-learn's `TfidfVectorizer` (character n-gram analyzer with `ngram_range=(2, 4)`). This creates typo-tolerant, sub-string sensitive vector representations of short key strings (like project names or identifiers).
  * **Cosine Similarity**: The system computes a cosine similarity matrix (`cosine_similarity(deleted_vectors, added_vectors)`) between deleted and added keys.
  * **Rename Detection**: If the similarity score exceeds `DEFAULT_THRESHOLD = 0.6`, the system links the source and target rows together as a "Renamed/Fuzzy Matched" pair rather than two separate addition/deletion actions.

---

## 3. Semantic Clustering & Schema Column Differences (Day-wise Report in NLP)
* **Code Location**:
  * **NLP Narrative & Clustering**: [insights.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/insights.py) (lines 5–19, 167–210, 252–378)
  * **Column Schema Differences**: [app.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/app.py) (lines 237–238)
  * **UI Display**: [App.jsx](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/frontend/src/App.jsx) (lines 1278–1279, 1283–1320)
* **Purpose**: Groups cell-level differences into semantic trends and matches them with column schema differences ("only columns" like *Day 1-only columns: None* and *Day 2-only columns: None*) to compile a comprehensive **Day-wise Report** which is stored in the vector store directory.
* **Mechanism**:
  * **Column Differences Extraction**: Column schema changes are identified in [app.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/app.py) using list comprehensions (`source_only_columns` / `target_only_columns`) and added to the diff report.
  * **Change Description**: Every changed cell is converted into a text statement: `"column: before_value -> after_value"`.
  * **Vector Embeddings**: These statements are vectorized using `TfidfVectorizer` (word analyzer with 1-to-2 n-grams).
  * **KMeans Clustering**: The vectors are passed through `KMeans` clustering (`n_clusters = max(2, min(5, n_texts // 3))`).
  * **Trend Synthesizing**: By clustering descriptions based on word similarity, changes like `"Cost Per Trip: 200 -> 210"` and `"Cost Per Trip: 400 -> 420"` are grouped into the same cluster. This allows the system to identify and write a single plain English summary sentence representing the trend (e.g., *"Most changes occurred in the Cost Per Trip column..."*).
  * **Unified Storage & Presentation**: Both the schema column differences and the clustered day-wise NLP report are bundled into a single JSON report file inside the `vector_store/reports/` directory via `save_series_diff_json` in [storage.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/storage.py) (lines 909-915).

---

## 4. Reports & Series Database Directory
* **Code Location**: [storage.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/storage.py) (lines 13–15, 30–32, 401–406, 633–642, 791–829, 909–915) & [app.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/app.py) (lines 828–868, 871–883)
* **Purpose**: Serves as the central repository for the project configuration file (`series.json`), daily transaction datasets (`series_data/`), and reconciliation reports (`reports/` directory containing JSON and Excel outputs) inside the `vector_store` folder, serving as a unified database.

---

## 5. PostgreSQL Storage for Value History Over Time
* **Code Location**:
  * **Database Persistence**: [db.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/db.py) (lines 377–408, 414–499)
  * **API Endpoint Handler**: [app.py](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/backend/app.py) (lines 1041–1042, 1089–1111)
  * **UI Table Grid**: [App.jsx](file:///c:/Users/Krishna%20Tiwari/Downloads/Reconciliation-merged-1/Reconciliation/frontend/src/App.jsx) (lines 1347–1385)
* **Purpose**: Persists row-level snapshot history in a Postgres database to compile and render the **Value History Over Time** pivot grid, ensuring a relational baseline is maintained.
* **Mechanism**:
  * **Row Snapping**: Every version uploaded calls `save_row_snapshot()` to write a JSONB representation of each row's data into the `series_row_values` Postgres table, indexed by the unique row key, series identifier, and version number.
  * **Pivoted Value Retrieval**: The `/api/series/<series_id>/history` endpoint invokes `get_value_history()`, which queries all stored versions for the series and pivots the values for each key and column dynamically (e.g. Day 1: 1545, Day 2: 1545).
  * **Baseline Comparison**: By relying on the persistent database backend rather than transient document chunks, the application guarantees exact historical value matching over time, as displayed in the UI grid.
