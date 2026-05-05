"""Flask backend — multi-file upload, slop-guard analysis, SQLite history."""

import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── DB setup ──────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent / "results.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS results (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                filename  TEXT NOT NULL,
                score     INTEGER NOT NULL,
                band      TEXT NOT NULL,
                word_count INTEGER NOT NULL,
                density   REAL,
                violations TEXT,
                advice    TEXT,
                analyzed_at TEXT NOT NULL
            )
        """)

init_db()

# ── slop-guard ────────────────────────────────────────────────────────────────

def _find_sg() -> list[str]:
    candidates = [
        Path(sys.executable).parent / "Scripts" / "sg.exe",
        Path(os.path.expanduser("~")) / "AppData" / "Roaming" / "Python"
            / f"Python{sys.version_info.major}{sys.version_info.minor}"
            / "Scripts" / "sg.exe",
    ]
    for c in candidates:
        if c.exists():
            return [str(c)]
    return [sys.executable, "-c", "from slop_guard.apps.cli import main; main()"]

SG_CMD = _find_sg()

def extract_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if ext == ".docx":
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="replace")

def run_slop_guard(text: str) -> dict:
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", encoding="utf-8", delete=False
    ) as tmp:
        tmp.write(text)
        tmp_path = tmp.name
    try:
        cmd = SG_CMD + ["-j", tmp_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if not result.stdout.strip():
            raise RuntimeError(
                f"slop-guard produced no output (exit {result.returncode}). "
                f"stderr: {result.stderr.strip() or '(empty)'}"
            )
        return json.loads(result.stdout)
    finally:
        os.unlink(tmp_path)

def save_result(filename: str, data: dict):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO results
               (filename, score, band, word_count, density, violations, advice, analyzed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                filename,
                data["score"],
                data["band"],
                data["word_count"],
                data.get("density"),
                json.dumps(data.get("violations", [])),
                json.dumps(data.get("advice", [])),
                datetime.now(timezone.utc).isoformat(),
            ),
        )

# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/analyze")
def analyze():
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "No files uploaded"}), 400

    results = []
    for file in files:
        if not file.filename:
            continue
        data = file.read()
        try:
            text = extract_text(file.filename, data)
        except Exception as exc:
            results.append({"filename": file.filename, "error": f"Could not extract text: {exc}"})
            continue

        if not text.strip():
            results.append({"filename": file.filename, "error": "No readable text found"})
            continue

        try:
            sg = run_slop_guard(text)
            sg["filename"] = file.filename
            save_result(file.filename, sg)
            results.append(sg)
        except Exception as exc:
            results.append({"filename": file.filename, "error": str(exc)})

    return jsonify(results)


@app.get("/history")
def history():
    limit = request.args.get("limit", 50, type=int)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM results ORDER BY analyzed_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "filename": r["filename"],
            "score": r["score"],
            "band": r["band"],
            "word_count": r["word_count"],
            "density": r["density"],
            "violations": json.loads(r["violations"]),
            "advice": json.loads(r["advice"]),
            "analyzed_at": r["analyzed_at"],
        })
    return jsonify(out)


@app.delete("/history/<int:result_id>")
def delete_result(result_id):
    with get_db() as conn:
        conn.execute("DELETE FROM results WHERE id = ?", (result_id,))
    return jsonify({"ok": True})


if __name__ == "__main__":
    print(f"Using sg command: {SG_CMD}")
    print(f"DB: {DB_PATH}")
    app.run(port=5000, debug=True)
