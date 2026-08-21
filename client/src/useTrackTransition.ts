import { useCallback, useEffect, useRef, useState, type AnimationEvent as ReactAnimationEvent } from "react";
import type { Track } from "./types";

export type TrackTransitionPhase = "entering" | "visible" | "exiting";

const TRACK_FADE_EXIT_FALLBACK_MS = 520;
const TRACK_FADE_ENTER_FALLBACK_MS = 720;

export function useTrackTransition(track: Track | null) {
  const [renderedTrack, setRenderedTrack] = useState<Track | null>(track);
  const [phase, setPhaseState] = useState<TrackTransitionPhase>(track ? "entering" : "visible");
  const renderedTrackRef = useRef<Track | null>(track);
  const pendingTrackRef = useRef<Track | null>(null);
  const phaseRef = useRef<TrackTransitionPhase>(track ? "entering" : "visible");
  const fallbackTimerRef = useRef<number | null>(null);

  const setPhase = useCallback((next: TrackTransitionPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);

  const finishEnter = useCallback(() => {
    clearFallback();
    if (phaseRef.current === "entering") setPhase("visible");
  }, [clearFallback, setPhase]);

  const showTrack = useCallback((next: Track) => {
    clearFallback();
    renderedTrackRef.current = next;
    setRenderedTrack(next);
    setPhase("entering");
    fallbackTimerRef.current = window.setTimeout(finishEnter, TRACK_FADE_ENTER_FALLBACK_MS);
  }, [clearFallback, finishEnter, setPhase]);

  const finishExit = useCallback(() => {
    clearFallback();
    const pending = pendingTrackRef.current;
    pendingTrackRef.current = null;
    if (pending) {
      showTrack(pending);
      return;
    }
    renderedTrackRef.current = null;
    setRenderedTrack(null);
    setPhase("visible");
  }, [clearFallback, setPhase, showTrack]);

  const startExit = useCallback(() => {
    if (!renderedTrackRef.current || phaseRef.current === "exiting") return;
    clearFallback();
    setPhase("exiting");
    fallbackTimerRef.current = window.setTimeout(finishExit, TRACK_FADE_EXIT_FALLBACK_MS);
  }, [clearFallback, finishExit, setPhase]);

  useEffect(() => {
    const rendered = renderedTrackRef.current;
    if (!rendered) {
      pendingTrackRef.current = null;
      if (track) showTrack(track);
      return;
    }

    if (track?.id === rendered.id) {
      renderedTrackRef.current = track;
      setRenderedTrack(track);
      pendingTrackRef.current = null;
      if (phaseRef.current === "exiting") {
        clearFallback();
        setPhase("visible");
      }
      return;
    }

    pendingTrackRef.current = track;
    startExit();
  }, [clearFallback, setPhase, showTrack, startExit, track]);

  useEffect(() => () => clearFallback(), [clearFallback]);

  const onAnimationEnd = useCallback((event: ReactAnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName.includes("now-track-fade-in")) finishEnter();
    if (event.animationName.includes("now-track-fade-out")) finishExit();
  }, [finishEnter, finishExit]);

  return { renderedTrack, phase, onAnimationEnd };
}
