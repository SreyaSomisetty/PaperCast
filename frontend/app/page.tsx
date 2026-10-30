"use client";

import { useState } from "react";
import { createEpisode, uploadDocument } from "@/lib/api";
import type {
  Episode,
  ExplanationMode,
  ListenerProfile,
} from "@/lib/types";

const MODES: { value: ExplanationMode; label: string }[] = [
  { value: "quick_brief", label: "Quick Brief" },
  { value: "deep_dive", label: "Deep Dive" },
  { value: "discussion", label: "Discussion" },
  { value: "study_review", label: "Study / Review" },
];

const PROFILES: { value: ListenerProfile; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "researcher", label: "Researcher" },
];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ListenerProfile>("student");
  const [mode, setMode] = useState<ExplanationMode>("quick_brief");
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setStatus("Uploading and extracting...");
    try {
      const res = await uploadDocument(file);
      setDocumentId(res.document_id);
      setStatus(`Uploaded "${res.filename}" (id: ${res.document_id}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!documentId) return;
    setBusy(true);
    setError("");
    setStatus("Running pipeline: plan → execute → evaluate → retry → render...");
    try {
      const ep = await createEpisode(documentId, profile, mode);
      setEpisode(ep);
      setStatus("Episode ready.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const checksBySegment = new Map(
    episode?.verification?.checks.map((c) => [c.segment_id, c]) ?? []
  );

  return (
    <main className="container">
      <header className="header">
        <h1>PaperCast</h1>
        <p>Interactive, evidence-grounded audio learning assistant.</p>
        <span className="badge">scaffold · UI not fully wired</span>
      </header>

      {/* Step 1: upload */}
      <section className="panel">
        <h2>1 · Upload a paper</h2>
        <p className="hint">Drop in an academic PDF to extract and index it.</p>
        <div className="row">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button onClick={handleUpload} disabled={!file || busy}>
            Upload
          </button>
        </div>
      </section>

      {/* Step 2: choose how to listen */}
      <section className="panel">
        <h2>2 · Choose how to listen</h2>
        <p className="hint">
          Pick a listener profile and an explanation mode.
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="profile">Profile</label>
            <select
              id="profile"
              value={profile}
              onChange={(e) =>
                setProfile(e.target.value as ListenerProfile)
              }
            >
              {PROFILES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mode">Mode</label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as ExplanationMode)}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button onClick={handleGenerate} disabled={!documentId || busy}>
              Generate episode
            </button>
          </div>
        </div>
      </section>

      {/* Status */}
      {(status || error) && (
        <section className="panel">
          <p className={error ? "status error" : "status"}>
            {error || status}
          </p>
        </section>
      )}

      {/* Step 3: episode */}
      {episode && (
        <section className="panel">
          <h2>3 · Episode</h2>
          <p className="hint">
            Script with per-claim evidence and verification. Audio urls are
            placeholders until the Speech service is implemented.
          </p>
          <div className="player">
            <button className="secondary" disabled>
              ▶ Play
            </button>
            <span className="muted">
              {episode.audio_segments.length} segment(s) ·{" "}
              {episode.script.approved ? "approved" : "not approved"}
            </span>
          </div>

          {episode.script.segments.map((seg) => {
            const check = checksBySegment.get(seg.segment_id);
            return (
              <div className="segment" key={seg.segment_id}>
                <div className="speaker">{seg.speaker}</div>
                <div>{seg.text}</div>
                <div className="evidence">
                  {check && (
                    <span className={`pill ${check.status}`}>
                      {check.status}
                    </span>
                  )}
                  evidence:{" "}
                  {seg.evidence_ids.length
                    ? seg.evidence_ids.join(", ")
                    : "none"}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
