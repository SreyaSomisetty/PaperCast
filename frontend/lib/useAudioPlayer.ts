// Drives one <audio> element and exposes the current position in milliseconds.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { count, logger } from "./logger";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_MS = 15_000;

export function useAudioPlayer(src: string | null, durationMs: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentMs(audio.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setFailed(true);
      count("ui.player_errors");
      logger.error("ui.player.error", {
        media_error_code: audio.error?.code,
        url: audio.currentSrc,
      });
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("error", onError);
    };
  }, [src]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, durationMs));
      if (audioRef.current) audioRef.current.currentTime = clamped / 1000;
      setCurrentMs(clamped);
    },
    [durationMs]
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, []);

  const skip = useCallback(
    (direction: 1 | -1) => seek(currentMs + direction * SKIP_MS),
    [currentMs, seek]
  );

  const setSpeed = useCallback((value: number) => {
    if (audioRef.current) audioRef.current.playbackRate = value;
    setSpeedState(value);
  }, []);

  return { audioRef, currentMs, playing, speed, failed, seek, toggle, skip, setSpeed };
}
