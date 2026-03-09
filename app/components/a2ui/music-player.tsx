// @input: Tool result with { songs: Song[] } from net.music_search
// @output: Complete music player mini-app — search, browse, play
// @position: A2UI showcase widget — "袖珍但强大"

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon,
  Volume2Icon, VolumeXIcon, SearchIcon, MusicIcon, Loader2Icon,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

/* ── Types ── */

type Song = { id: number; name: string; artist: string; album: string; cover: string; duration: number; playable?: boolean };
type PlayerState = "idle" | "loading" | "playing" | "paused" | "error";

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/* ── Main Component ── */

const MusicPlayerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [current, setCurrent] = useState(-1);
  const [state, setState] = useState<PlayerState>("idle");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Refs for stable event handler access (avoid stale closures)
  const songsRef = useRef(songs);
  const currentRef = useRef(current);
  songsRef.current = songs;
  currentRef.current = current;

  // Initialize from tool result
  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (!Object.keys(json).length) return;
    const raw = (json.songs ?? []) as Array<Record<string, unknown>>;
    const list: Song[] = raw.map(normalizeSong);
    if (list.length > 0) {
      setSongs(list);
      setQuery((json.query as string) ?? "");
      void enrichCovers(list).then(setSongs);
    }
  }, [result, status.type]);

  // Play a song by index — defined as ref-stable function
  const playIndex = useCallback((index: number) => {
    const song = songsRef.current[index];
    const audio = audioRef.current;
    if (!song || !audio) return;
    setCurrent(index);
    setState("loading");
    audio.src = `/api/music/url?id=${song.id}`;
    audio.load();
    audio.play().catch(() => setState("error"));
  }, []);

  // Audio event wiring — mount once, never re-wire
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const h = {
      timeupdate: () => setProgress(audio.currentTime),
      durationchange: () => setDuration(audio.duration || 0),
      playing: () => setState("playing"),
      pause: () => setState("paused"),
      waiting: () => setState("loading"),
      error: () => {
        // Auto-skip to next song on error (e.g. unplayable track)
        const s = songsRef.current;
        const cur = currentRef.current;
        if (s.length > 1 && cur >= 0) {
          playIndex((cur + 1) % s.length);
        } else {
          setState("error");
        }
      },
      ended: () => {
        const s = songsRef.current;
        if (s.length === 0) return;
        playIndex((currentRef.current + 1) % s.length);
      },
    };
    for (const [e, fn] of Object.entries(h)) audio.addEventListener(e, fn);
    return () => { for (const [e, fn] of Object.entries(h)) audio.removeEventListener(e, fn); };
  }, [playIndex]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    if (audio.src) { audio.play().catch(() => setState("error")); return; }
    if (songsRef.current.length > 0) playIndex(0);
  }, [playIndex]);

  const next = useCallback(() => {
    if (songsRef.current.length === 0) return;
    playIndex((currentRef.current + 1) % songsRef.current.length);
  }, [playIndex]);

  const prev = useCallback(() => {
    const s = songsRef.current;
    if (s.length === 0) return;
    playIndex(currentRef.current <= 0 ? s.length - 1 : currentRef.current - 1);
  }, [playIndex]);

  const seekTo = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = value;
  }, []);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}&limit=6`);
      const data = (await res.json()) as { songs: Song[] };
      setSongs(data.songs ?? []);
      setCurrent(-1);
    } finally { setSearching(false); }
  }, [query]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const m = !muted;
    setMuted(m);
    audio.muted = m;
  }, [muted]);

  const currentSong = current >= 0 ? songs[current] : null;
  const isActive = state === "playing" || state === "loading";
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const queuePips = Math.max(1, Math.min(5, songs.length || 1));

  const skeleton = (
    <div className="flex items-center gap-2.5 p-3">
      <div className="size-10 animate-pulse rounded-full bg-zinc-800" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-zinc-800" />
        <div className="h-2 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-5 top-4 h-16 rounded-[22px] bg-[radial-gradient(circle_at_20%_24%,rgba(255,43,85,0.10),transparent_48%),radial-gradient(circle_at_78%_22%,rgba(86,146,255,0.08),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_70%)]" />

        <div className="relative flex items-center gap-3 px-3 py-3">
          <div className={cn(
            "relative size-12 shrink-0 overflow-hidden rounded-full bg-zinc-900 ring-1 ring-white/7 transition",
            isActive && "ring-[#ff2b55]/24 shadow-[0_0_0_3px_rgba(255,43,85,0.04)]",
          )}>
            {currentSong?.cover ? (
              <img src={currentSong.cover} alt={currentSong.name} // eslint-disable-line @next/next/no-img-element
                className={cn("size-full object-cover", isActive && "animate-[spin_14s_linear_infinite]")} />
            ) : (
              <div className="flex size-full items-center justify-center"><MusicIcon className="size-4 text-zinc-600" /></div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-white leading-tight">{currentSong?.name ?? "Music Flow"}</p>
                <p className="truncate text-[10px] text-zinc-500 leading-tight">{currentSong?.artist ?? "Search to lock onto a track"}</p>
              </div>
              <div className="flex items-center gap-1 pt-0.5">
                {Array.from({ length: queuePips }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "block rounded-full transition-all",
                      index === Math.min(Math.max(current, 0), queuePips - 1)
                        ? "h-1.5 w-3 bg-[#ff2b55]"
                        : "size-1 bg-white/14",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="group mt-2 flex items-center gap-2">
              <span className="w-7 text-right text-[10px] tabular-nums text-zinc-500">{fmtTime(progress)}</span>
              <input
                type="range"
                min={0}
                max={Math.round(duration) || 1}
                value={Math.round(progress)}
                onChange={(e) => seekTo(e.target.valueAsNumber)}
                aria-label="Seek"
                className="flex-1 h-[3px] cursor-pointer appearance-none rounded-full bg-white/8 accent-[#ff2b55] [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:transition-opacity group-hover:[&::-webkit-slider-thumb]:opacity-100"
                style={{
                  backgroundImage: `linear-gradient(to right, #ff2b55 ${progressRatio * 100}%, rgba(255,255,255,0.08) ${progressRatio * 100}%)`,
                }}
              />
              <span className="w-7 text-[10px] tabular-nums text-zinc-500">{fmtTime(duration || (currentSong?.duration ?? 0))}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-full bg-white/[0.045] p-1">
                <button onClick={prev} aria-label="Previous track"
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
                  <SkipBackIcon className="size-3" />
                </button>
                <button onClick={toggle} aria-label={state === "playing" ? "Pause" : "Play"} className={cn(
                  "flex size-9 items-center justify-center rounded-full text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
                  isActive
                    ? "bg-white text-black shadow-[0_6px_16px_rgba(255,255,255,0.16)]"
                    : "bg-white/10 hover:bg-white/15",
                )}>
                  {state === "loading" ? <Loader2Icon className="size-4 animate-spin" />
                    : state === "playing" ? <PauseIcon className="size-4" fill="currentColor" />
                    : <PlayIcon className="size-4" fill="currentColor" />}
                </button>
                <button onClick={next} aria-label="Next track"
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
                  <SkipForwardIcon className="size-3" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}
                  className="flex size-7 items-center justify-center rounded-full text-zinc-500 transition hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
                  {muted ? <VolumeXIcon className="size-3" /> : <Volume2Icon className="size-3" />}
                </button>
                <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Volume"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (audioRef.current) audioRef.current.volume = v;
                    if (v > 0 && muted) setMuted(false);
                  }}
                  className="h-0.5 w-14 cursor-pointer appearance-none rounded-full bg-white/8 accent-[#ff2b55] [&::-webkit-slider-thumb]:size-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white" />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/6 px-3 py-2">
          <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/22 px-3 py-2">
            <SearchIcon className="size-3 shrink-0 text-zinc-500" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder="Search or switch track"
              className="flex-1 bg-transparent text-[11px] text-white placeholder-zinc-600 outline-none" />
            {searching && <Loader2Icon className="size-3 animate-spin text-zinc-400" />}
          </div>
        </div>

        {songs.length > 0 && (
          <div className="max-h-40 overflow-y-auto border-t border-white/6 px-3 py-1.5">
            <div className="space-y-0.5">
              {songs.map((song, i) => (
                <button key={song.id} onClick={() => playIndex(i)} disabled={song.playable === false}
                  aria-current={i === current ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[15px] border border-transparent px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
                    i === current ? "bg-white/7 border-white/7" : "hover:bg-white/[0.04]",
                    !song.playable && "opacity-35",
                  )}>
                  <div className={cn(
                    "relative size-9 shrink-0 overflow-hidden rounded-[11px] bg-zinc-900 ring-1 ring-white/8",
                    i === current && "ring-[#ff2b55]/24",
                  )}>
                    {song.cover ? (
                      <img src={song.cover} alt="" className="size-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                    ) : (
                      <div className="flex size-full items-center justify-center"><MusicIcon className="size-3 text-zinc-600" /></div>
                    )}
                    {i === current && isActive && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                        <div className="flex items-end gap-[2px]">
                          <span className="inline-block w-[2px] animate-[equalizer_0.8s_ease-in-out_infinite] bg-[#ff2b55]" style={{ height: 6 }} />
                          <span className="inline-block w-[2px] animate-[equalizer_0.8s_ease-in-out_0.2s_infinite] bg-[#ff7a8f]" style={{ height: 10 }} />
                          <span className="inline-block w-[2px] animate-[equalizer_0.8s_ease-in-out_0.4s_infinite] bg-[#5c92ff]" style={{ height: 5 }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[11px] font-medium", i === current ? "text-white" : "text-zinc-300")}>{song.name}</p>
                    <p className="truncate text-[10px] text-zinc-500">{song.artist} - {fmtTime(song.duration)}</p>
                  </div>
                  {i === current ? (
                    <span className="h-1.5 w-3 rounded-full bg-[#ff2b55]" />
                  ) : (
                    <span className="size-1 rounded-full bg-white/14" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </DarkShell>
  );
};

/* ── Helpers ── */

const normalizeSong = (raw: Record<string, unknown>): Song => ({
  id: Number(raw.id) || 0,
  name: String(raw.name ?? ""),
  artist: String(raw.artist ?? ""),
  album: String(raw.album ?? ""),
  cover: String(raw.cover ?? raw.cover_url ?? ""),
  duration: Number(raw.duration ?? raw.duration_sec ?? 0),
  playable: raw.playable !== false,
});

const enrichCovers = async (songs: Song[]): Promise<Song[]> => {
  const missing = songs.filter((s) => !s.cover && s.id);
  if (missing.length === 0) return songs;
  try {
    const res = await fetch(`/api/music/search?q=${encodeURIComponent(songs[0]?.name ?? "")}&limit=1`);
    if (!res.ok) return songs;
    const data = (await res.json()) as { songs: Array<Record<string, unknown>> };
    const coverMap = new Map<number, string>();
    for (const s of data.songs ?? []) if (s.cover) coverMap.set(Number(s.id), String(s.cover));
    return songs.map((s) => ({ ...s, cover: s.cover || coverMap.get(s.id) || "" }));
  } catch { return songs; }
};

export const MusicPlayer = memoWidget(MusicPlayerImpl);

