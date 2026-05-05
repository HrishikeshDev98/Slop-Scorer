import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";

const API = "http://localhost:5000";

const BAND_COLOR = {
  clean: "#22c55e",
  light: "#84cc16",
  moderate: "#f59e0b",
  heavy: "#ef4444",
  saturated: "#7f1d1d",
};

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, band, size = 120 }) {
  const color = BAND_COLOR[band] ?? "#888";
  const r = size * 0.39;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <div className="score-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#2a2a2a" strokeWidth="10" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="score-center">
        <span className="score-number">{score}</span>
        <span className="score-band" style={{ color }}>{band}</span>
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ result, onDelete }) {
  const [open, setOpen] = useState(false);
  if (result.error) {
    return (
      <div className="result-card error-result">
        <strong>{result.filename}</strong>
        <span className="err-msg">{result.error}</span>
      </div>
    );
  }
  return (
    <div className="result-card">
      <div className="result-header" onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}>
        <ScoreRing score={result.score} band={result.band} size={100} />
        <div className="result-meta">
          <div className="meta-row"><span>File</span><strong className="filename-trunc">{result.filename}</strong></div>
          <div className="meta-row"><span>Words</span><strong>{result.word_count}</strong></div>
          <div className="meta-row"><span>Density</span><strong>{result.density?.toFixed(2) ?? "—"}</strong></div>
          <div className="meta-row"><span>Violations</span><strong>{result.violations?.length ?? 0}</strong></div>
          {result.analyzed_at && (
            <div className="meta-row">
              <span>Analyzed</span>
              <strong>{new Date(result.analyzed_at).toLocaleString()}</strong>
            </div>
          )}
        </div>
        <div className="card-actions">
          <span className="toggle-btn">{open ? "▲" : "▼"}</span>
          {onDelete && (
            <button className="delete-btn" onClick={e => { e.stopPropagation(); onDelete(result.id); }}
              title="Delete from history">✕</button>
          )}
        </div>
      </div>

      {open && (
        <div className="result-body">
          {result.advice?.length > 0 && (
            <section className="advice-section">
              <h3>Advice</h3>
              <ul>{result.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </section>
          )}
          {result.violations?.length > 0 && (
            <section className="violations-section">
              <h3>Violations ({result.violations.length})</h3>
              <div className="violations-list">
                {result.violations.map((v, i) => (
                  <div key={i} className="violation-row">
                    <span className="v-rule">{v.rule}</span>
                    <span className="v-match">"{v.match}"</span>
                    <span className="v-penalty">−{Math.abs(v.penalty)}</span>
                    <span className="v-ctx">{v.context}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── URL input ─────────────────────────────────────────────────────────────────

function UrlInput({ onResult, onLoading }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    onLoading(true);
    try {
      const res = await fetch(`${API}/analyze-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server error");
      onResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      onLoading(false);
    }
  }

  return (
    <div className="url-input-wrap">
      <form className="url-form" onSubmit={submit}>
        <input
          type="url"
          className="url-field"
          placeholder="https://example.com/article"
          value={url}
          onChange={e => setUrl(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" className="url-btn" disabled={!url.trim()}>
          Analyze
        </button>
      </form>
      {error && <p className="url-error">{error}</p>}
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────

const HISTORY_FILTERS = ["all", "clean", "light", "moderate"];

function HistoryTab({ history, loading, onDelete }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? history
    : history.filter(r => r.band === filter);

  const countFor = band => band === "all"
    ? history.length
    : history.filter(r => r.band === band).length;

  return (
    <>
      <div className="history-filters">
        {HISTORY_FILTERS.map(f => (
          <button
            key={f}
            className={`hf-btn${filter === f ? " active" : ""}${f !== "all" ? ` hf-${f}` : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="hf-count">{countFor(f)}</span>
          </button>
        ))}
      </div>

      <div className="results-list">
        {loading && (
          <div className="status-card"><div className="spinner" /><span>Loading history…</span></div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="empty-state">
            {history.length === 0
              ? "No results saved yet. Analyze some files first."
              : `No ${filter} results.`}
          </p>
        )}
        {!loading && filtered.map(r => (
          <ResultCard key={r.id} result={r} onDelete={onDelete} />
        ))}
      </div>
    </>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("analyze"); // "analyze" | "history"
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // "Analyzing 3 files…"
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const inputRef = useRef();

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/history`);
      setHistory(await res.json());
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  async function analyzeFiles(files) {
    if (!files.length) return;
    setLoading(true);
    setResults([]);
    setProgress(`Analyzing ${files.length} file${files.length > 1 ? "s" : ""}…`);

    const form = new FormData();
    for (const f of files) form.append("files", f);

    try {
      const res = await fetch(`${API}/analyze`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server error");
      setResults(data);
    } catch (e) {
      setResults([{ error: e.message, filename: "Upload failed" }]);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function onFileChange(e) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) analyzeFiles(files);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) analyzeFiles(files);
  }

  async function deleteHistory(id) {
    await fetch(`${API}/history/${id}`, { method: "DELETE" });
    setHistory(h => h.filter(r => r.id !== id));
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Slop<span>Guard</span></h1>
        <p className="subtitle">Detect AI writing patterns — scored 0–100</p>
      </header>

      <nav className="tabs">
        <button className={tab === "analyze" ? "active" : ""} onClick={() => setTab("analyze")}>Analyze</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); }}>History</button>
      </nav>

      {tab === "analyze" && (
        <>
          <div
            className={`drop-zone${dragging ? " drag-over" : ""}`}
            onClick={() => inputRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" multiple hidden onChange={onFileChange} />
            <div className="drop-icon">📂</div>
            <p>Drop files here — <strong>PDF, DOCX, TXT, MD</strong>, and more</p>
            <p className="drop-hint">Multiple files supported · click to browse</p>
          </div>

          <div className="divider"><span>or paste a URL</span></div>

          <UrlInput onResult={r => setResults([r])} onLoading={setLoading} />

          {loading && (
            <div className="status-card">
              <div className="spinner" />
              <span>{progress || "Analyzing…"}</span>
            </div>
          )}

          {results.length > 0 && !loading && (
            <div className="results-list">
              <p className="results-count">{results.length} result{results.length > 1 ? "s" : ""}</p>
              {results.map((r, i) => <ResultCard key={i} result={r} />)}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <HistoryTab
          history={history}
          loading={historyLoading}
          onDelete={deleteHistory}
        />
      )}
    </div>
  );
}
