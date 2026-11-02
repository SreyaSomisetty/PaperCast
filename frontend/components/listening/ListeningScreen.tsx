"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugPanel } from "@/components/common/DebugPanel";
import { ErrorBanner } from "@/components/common/ErrorBanner";
import { ApiError, exportUrl, getEpisode, mediaUrl } from "@/lib/api";
import { indexAt } from "@/lib/audioSync";
import { count } from "@/lib/logger";
import { failureFor } from "@/lib/messages";
import { modeOption, PROFILES } from "@/lib/modes";
import { placeholderManifest, silentWav } from "@/lib/placeholderAudio";
import { LAST_EPISODE_KEY, writeSession } from "@/lib/session";
import { useAudioPlayer } from "@/lib/useAudioPlayer";
import { toViewModel } from "@/lib/viewModel";
import type { EpisodeView } from "@/types/api";
import type { SentenceVM } from "@/types/view";
import { EvidencePanel } from "./EvidencePanel";
import { ExtensionPanel } from "./ExtensionPanel";
import { Player } from "./Player";
import { ScriptPanel } from "./ScriptPanel";
import { sentenceDomId } from "./SentenceLine";

export function ListeningScreen({ episodeId }: { episodeId: string }) {
  const [episode, setEpisode] = useState<EpisodeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setEpisode(null);
    setError(null);
    getEpisode(episodeId, ctrl.signal)
      .then((view) => {
        setEpisode(view);
        writeSession(LAST_EPISODE_KEY, view.episode_id);
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) {
          setError(
            e.status === 404
              ? "We could not find this episode."
              : "We could not load this episode."
          );
        }
      });
    return () => ctrl.abort();
  }, [episodeId]);

  if (error) return <Notice message={error} />;
  if (!episode) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted">
        <h1 className="sr-only">Listening</h1>
        Loading the episode…
      </main>
    );
  }
  // A failed or unfinished run may hold segments that were never approved, so
  // no script is shown as an episode (SR-UI-7).
  if (episode.status === "FAILED") {
    return <Notice message={failureFor(episode.error_code).message} />;
  }
  if (episode.status !== "COMPLETED") {
    return <Notice message="This episode is still being made." tone="info" />;
  }
  return <ReadyEpisode episode={episode} />;
}

function Notice({
  message,
  tone = "error",
}: {
  message: string;
  tone?: "error" | "info";
}) {
  return (
    <main className="mx-auto max-w-6xl space-y-3 px-6 py-6">
      <h1 className="sr-only">Listening</h1>
      {tone === "error" ? (
        <ErrorBanner>{message}</ErrorBanner>
      ) : (
        <p className="text-sm text-muted">{message}</p>
      )}
      <Link href="/" className="text-sm font-medium text-navy underline">
        Back to the Library
      </Link>
    </main>
  );
}

function ReadyEpisode({ episode }: { episode: EpisodeView }) {
  const isPlaceholder = !episode.audio?.episode_url;
  const placeholder = useMemo(() => placeholderManifest(episode), [episode]);
  const manifest = isPlaceholder ? placeholder.segments : episode.audio!.segments;
  const durationMs = isPlaceholder
    ? placeholder.durationMs
    : episode.audio!.duration_ms;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPlaceholder) return;
    const url = URL.createObjectURL(silentWav(placeholder.durationMs));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isPlaceholder, placeholder.durationMs]);
  const src = isPlaceholder ? blobUrl : mediaUrl(episode.audio!.episode_url as string);

  const player = useAudioPlayer(src, durationMs);
  const segments = useMemo(
    () => toViewModel(episode, manifest),
    [episode, manifest]
  );
  const sentences = useMemo(
    () =>
      segments.flatMap((s) =>
        s.turns.flatMap((t) => t.sentences.filter((x) => x.startMs !== null))
      ),
    [segments]
  );
  const starts = useMemo(() => sentences.map((s) => s.startMs as number), [sentences]);
  const segmentStarts = useMemo(() => segments.map((s) => s.startMs ?? 0), [segments]);

  const activeKey = sentences[indexAt(starts, player.currentMs)]?.key ?? null;
  const segmentIndex = indexAt(segmentStarts, player.currentMs);

  const [selected, setSelected] = useState<SentenceVM | null>(null);
  const evidenceRef = useRef<HTMLElement>(null);

  const openEvidence = useCallback((sentence: SentenceVM) => {
    if (sentence.kind === "claim") setSelected(sentence);
  }, []);

  const select = useCallback(
    (sentence: SentenceVM) => {
      openEvidence(sentence);
      if (sentence.startMs !== null) {
        count("ui.sentence_seeks");
        player.seek(sentence.startMs);
      }
    },
    [openEvidence, player]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const sentenceKey = target.dataset?.sentence;

      if (e.key === " ") {
        // Other buttons keep their own Space behavior.
        if (target.closest("button, a") && !sentenceKey) return;
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const direction = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) {
          const next = segmentStarts[segmentIndex + direction];
          if (next !== undefined) player.seek(next);
        } else {
          player.skip(direction);
        }
      } else if ((e.key === "e" || e.key === "E") && sentenceKey) {
        const sentence = sentences.find((s) => s.key === sentenceKey);
        if (sentence) {
          openEvidence(sentence);
          evidenceRef.current?.focus();
        }
      } else if (e.key === "Escape" && selected) {
        document.getElementById(sentenceDomId(selected.key))?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, segmentStarts, segmentIndex, sentences, selected, openEvidence]);

  const profile = PROFILES.find((p) => p.value === episode.profile)?.label;
  const title = `${episode.document.title} · ${modeOption(episode.mode).label} · ${profile}`;

  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-6 py-6 lg:grid-cols-[3fr_2fr]">
      <h1 className="sr-only">Listening: {episode.document.title}</h1>
      {src && <audio ref={player.audioRef} src={src} preload="metadata" />}

      <div className="min-w-0 space-y-4">
        <Player
          title={title}
          segments={segments}
          segmentIndex={segmentIndex}
          currentMs={player.currentMs}
          durationMs={durationMs}
          playing={player.playing}
          speed={player.speed}
          failed={player.failed}
          placeholder={isPlaceholder}
          downloadUrl={
            episode.audio?.export_url ? exportUrl(episode.episode_id) : null
          }
          onToggle={player.toggle}
          onSkip={player.skip}
          onSpeed={player.setSpeed}
          onSeek={player.seek}
        />
        <ScriptPanel
          segments={segments}
          removed={episode.removed_claims}
          activeKey={activeKey}
          selectedKey={selected?.key ?? null}
          onSelect={select}
        />
      </div>

      <div className="min-w-0 space-y-4">
        <EvidencePanel
          documentId={episode.document.document_id}
          sentence={selected}
          panelRef={evidenceRef}
        />
        <ExtensionPanel
          title="Ask or steer"
          description="Ask a question, or ask for a simpler or deeper explanation."
        />
        <ExtensionPanel
          title="Check-in"
          description="A short question after a section."
        />
        <DebugPanel episode={episode} />
      </div>
    </main>
  );
}
