"use client";

import { useRef, useState, type DragEvent } from "react";
import { MAX_UPLOAD_MB } from "@/lib/config";

export function UploadZone({
  disabled,
  percent,
  uploading,
  notice,
  onFile,
}: {
  disabled: boolean;
  percent: number;
  uploading: boolean;
  notice: string | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <section aria-label="Upload a paper" className="rounded-lg bg-card p-4 shadow-sm">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded border-2 border-dashed p-6 text-center ${
          dragging ? "border-navy bg-idle-soft" : "border-line"
        }`}
      >
        <p className="text-sm font-semibold">Drop a PDF here or browse</p>
        <p className="mt-1 text-xs text-muted">
          Academic papers and technical reports (PDF, up to {MAX_UPLOAD_MB} MB, about
          30 pages)
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="mt-3 rounded bg-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose a PDF
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="PDF file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so the same file can be chosen again
            if (file) onFile(file);
          }}
        />
      </div>

      {uploading && (
        <div className="mt-3">
          <p className="text-xs text-muted">Uploading: {percent}%</p>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1 h-1.5 rounded bg-idle-soft"
          >
            <div className="h-full rounded bg-navy" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {notice && (
        <p role="alert" className="mt-3 rounded bg-bad-soft px-3 py-2 text-sm text-bad">
          {notice}
        </p>
      )}
    </section>
  );
}
