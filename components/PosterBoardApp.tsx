"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  Search,
  SprayCan,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import AddPosterModal from "@/components/AddPosterModal";
import { POLE_HEIGHT } from "@/components/poleConstants";
import { clearPosters, createPoster, deletePoster, fetchPosters, uploadPosterImage } from "@/lib/posters";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { PendingPoster, Poster, PosterDraft, StapleMark } from "@/types/poster";

const PoleScene = dynamic(() => import("@/components/PoleScene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm font-semibold text-[#27423b]">
      Loading pole...
    </div>
  )
});

type Toast = {
  tone: "good" | "warn" | "bad";
  message: string;
};

type StapleSession = {
  poster: PendingPoster;
  angle: number;
  y: number;
  staples: StapleMark[];
};

type SpraySession = {
  poster: PendingPoster;
  angle: number;
  y: number;
  sprays: number;
};

const REQUIRED_STAPLES = 4;
const REQUIRED_SPRAYS = 3;
const SOUND_ENABLED_KEY = "ct-pole:sound-enabled";
const CITY_AMBIENCE_URL = "/sounds/city-ambience-loop-30s.mp3";
const CITY_AMBIENCE_VOLUME = 0.18;

export default function PosterBoardApp() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingPoster, setPendingPoster] = useState<PendingPoster | null>(null);
  const [editingPoster, setEditingPoster] = useState<PendingPoster | null>(null);
  const [stapleSession, setStapleSession] = useState<StapleSession | null>(null);
  const [spraySession, setSpraySession] = useState<SpraySession | null>(null);
  const [placementDrop, setPlacementDrop] = useState<{ id: number; x: number; y: number } | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ id: string; angle: number; y: number } | null>(null);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [isAdminBusy, setIsAdminBusy] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const temporaryToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ambienceAudio = useRef<HTMLAudioElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const staplingPoster = useMemo<Poster | null>(() => {
    if (!stapleSession) {
      return null;
    }

    return {
      ...stapleSession.poster,
      id: "stapling-preview",
      angle: stapleSession.angle,
      y: stapleSession.y,
      staples: stapleSession.staples,
      created_at: new Date(0).toISOString()
    };
  }, [stapleSession]);
  const sprayingPoster = useMemo<Poster | null>(() => {
    if (!spraySession) {
      return null;
    }

    return {
      ...spraySession.poster,
      id: "spraying-preview",
      angle: spraySession.angle,
      y: spraySession.y,
      staples: [],
      created_at: new Date(0).toISOString()
    };
  }, [spraySession]);
  const searchResults = useMemo(() => {
    const normalizedQuery = normalizeContactSearch(searchQuery);
    if (!normalizedQuery) {
      return [];
    }

    return posters.filter((poster) => normalizeContactSearch(poster.contact ?? "") === normalizedQuery);
  }, [posters, searchQuery]);
  const recentAdditions = useMemo(() => {
    return [...posters]
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, 3);
  }, [posters]);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const storedPreference = localStorage.getItem(SOUND_ENABLED_KEY);

    if (storedPreference === "false") {
      setIsSoundEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSearchIndex >= searchResults.length) {
      setSelectedSearchIndex(Math.max(0, searchResults.length - 1));
    }
  }, [searchResults.length, selectedSearchIndex]);

  useEffect(() => {
    let mounted = true;

    fetchPosters()
      .then((loaded) => {
        if (mounted) {
          setPosters(loaded);
        }
      })
      .catch((error) => {
        setToast({ tone: "bad", message: error.message });
      });

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        mounted = false;
      };
    }

    const supabaseClient = supabase;
    const channel = supabaseClient
      .channel("public:posters")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "posters"
        },
        (payload) => {
          if (!mounted) {
            return;
          }

          if (payload.eventType === "INSERT") {
            const poster = normalizeRealtimePoster(payload.new);
            if (!poster) {
              return;
            }

            setPosters((current) => {
              if (current.some((item) => item.id === poster.id)) {
                return current;
              }

              return [...current, poster].sort(
                (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
              );
            });
          }

          if (payload.eventType === "UPDATE") {
            const poster = normalizeRealtimePoster(payload.new);
            if (!poster) {
              return;
            }

            setPosters((current) => current.map((item) => (item.id === poster.id ? poster : item)));
          }

          if (payload.eventType === "DELETE") {
            const deletedId = typeof payload.old.id === "string" ? payload.old.id : null;
            if (!deletedId) {
              return;
            }

            setPosters((current) => current.filter((poster) => poster.id !== deletedId));
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setTemporaryToast({ tone: "warn", message: "Live updates disconnected. Refresh to sync." });
        }
      });

    return () => {
      mounted = false;
      void supabaseClient.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const audio = new Audio(CITY_AMBIENCE_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = CITY_AMBIENCE_VOLUME;
    ambienceAudio.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      ambienceAudio.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SOUND_ENABLED_KEY, String(isSoundEnabled));

    const audioElement = ambienceAudio.current;
    if (!audioElement) {
      return;
    }

    audioElement.volume = CITY_AMBIENCE_VOLUME;

    if (!isSoundEnabled) {
      audioElement.pause();
      audioElement.currentTime = 0;
      return;
    }

    let shouldKeepListeners = true;
    const audio = audioElement;

    function removeStartListeners() {
      window.removeEventListener("pointerdown", tryPlayFromGesture);
      window.removeEventListener("keydown", tryPlayFromGesture);
      window.removeEventListener("touchstart", tryPlayFromGesture);
    }

    function tryPlayFromGesture() {
      void audio.play().then(removeStartListeners).catch(() => {
        if (!shouldKeepListeners) {
          removeStartListeners();
        }
      });
    }

    void audio.play().catch(() => {
      window.addEventListener("pointerdown", tryPlayFromGesture, { once: true });
      window.addEventListener("keydown", tryPlayFromGesture, { once: true });
      window.addEventListener("touchstart", tryPlayFromGesture, { once: true });
    });

    return () => {
      shouldKeepListeners = false;
      removeStartListeners();
    };
  }, [isSoundEnabled]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setAdminError(null);
        setIsAdminLoginOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (temporaryToastTimer.current) {
        clearTimeout(temporaryToastTimer.current);
      }
    };
  }, []);

  async function handleDraftCreated(draft: PosterDraft) {
    setIsSaving(true);
    setToast(null);

    try {
      const imageUrl = draft.imageFile ? await uploadPosterImage(draft.imageFile) : draft.existingImageUrl ?? null;
      setPendingPoster({
        type: draft.type,
        text: draft.text.trim() || null,
        image_url: imageUrl,
        color: draft.color,
        contact: normalizeTwitterHandle(draft.contact),
        width: draft.width,
        height: draft.height
      });
      setIsModalOpen(false);
      setEditingPoster(null);
      setToast({ tone: "good", message: "Placement armed" });
    } catch (error) {
      setToast({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not create poster."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAttach(hit: { angle: number; y: number }) {
    if (!pendingPoster) {
      return;
    }

    if (pendingPoster.type === "poster") {
      setStapleSession({
        poster: pendingPoster,
        angle: hit.angle,
        y: hit.y,
        staples: []
      });
      setPendingPoster(null);
      setToast({ tone: "good", message: `Staple the poster 0/${REQUIRED_STAPLES}` });
      return;
    }

    setSpraySession({
      poster: pendingPoster,
      angle: hit.angle,
      y: hit.y,
      sprays: 0
    });
    setPendingPoster(null);
    setToast({ tone: "good", message: `Spray inside the outline 0/${REQUIRED_SPRAYS}` });
  }

  async function handleSpray(_hit?: { angle: number; y: number }, passes = 1) {
    if (!spraySession || isSaving) {
      return;
    }

    const nextSprays = Math.min(REQUIRED_SPRAYS, spraySession.sprays + passes);
    const nextSession = {
      ...spraySession,
      sprays: nextSprays
    };

    setSpraySession(nextSession);

    if (nextSprays < REQUIRED_SPRAYS) {
      setToast({
        tone: "good",
        message: `Spray inside the outline ${nextSprays}/${REQUIRED_SPRAYS}`
      });
      return;
    }

    setIsSaving(true);
    setToast(null);

    try {
      const poster = await createPoster({
        ...spraySession.poster,
        angle: spraySession.angle,
        y: spraySession.y,
        staples: []
      });
      setPosters((current) => [...current, poster]);
      setSpraySession(null);
      focusPoster(poster, "Graffiti sprayed");
    } catch (error) {
      setToast({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not save poster."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStaple(hit: { angle: number; y: number }) {
    if (!stapleSession || isSaving) {
      return;
    }

    const nextStaples = [...stapleSession.staples, hit].slice(0, REQUIRED_STAPLES);
    const nextSession = {
      ...stapleSession,
      staples: nextStaples
    };

    setStapleSession(nextSession);

    if (nextStaples.length < REQUIRED_STAPLES) {
      setToast({
        tone: "good",
        message: `Staple the poster ${nextStaples.length}/${REQUIRED_STAPLES}`
      });
      return;
    }

    setIsSaving(true);
    setToast(null);

    try {
      const poster = await createPoster({
        ...stapleSession.poster,
        type: "poster",
        text: stapleSession.poster.text?.trim() || "Has anyone seen my stapler?",
        angle: stapleSession.angle,
        y: stapleSession.y,
        staples: nextStaples
      });
      setPosters((current) => [...current, poster]);
      setStapleSession(null);
      focusPoster(poster, "Poster stapled");
    } catch (error) {
      setToast({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not save poster."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (searchResults.length === 0) {
      setToast({ tone: "warn", message: "No works for that contact" });
      return;
    }

    focusSearchResult(0);
  }

  function focusSearchResult(index: number) {
    const result = searchResults[index];
    if (!result) {
      return;
    }

    setSelectedSearchIndex(index);
    focusPoster(result, `Showing ${index + 1}/${searchResults.length} for ${formatContactForDisplay(result.contact ?? "")}`);
  }

  function setTemporaryToast(nextToast: Toast, duration = 5000) {
    if (temporaryToastTimer.current) {
      clearTimeout(temporaryToastTimer.current);
    }

    setToast(nextToast);

    temporaryToastTimer.current = setTimeout(() => {
      setToast((current) =>
        current?.tone === nextToast.tone && current.message === nextToast.message ? null : current
      );
      temporaryToastTimer.current = null;
    }, duration);
  }

  function focusPoster(poster: Poster, message?: string) {
    setFocusTarget({
      id: `${poster.id}:${Date.now()}`,
      angle: poster.angle,
      y: poster.y
    });
    setTemporaryToast({
      tone: "good",
      message: message ?? `Showing ${formatContactForDisplay(poster.contact ?? "")}`
    });
  }


  async function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAdminBusy(true);
    setAdminError(null);

    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password: adminPassword })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Wrong password");
      }

      setIsAdminUnlocked(true);
      setIsAdminLoginOpen(false);
      setTemporaryToast({ tone: "good", message: "Admin mode unlocked" }, 3500);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Wrong password");
    } finally {
      setIsAdminBusy(false);
    }
  }

  async function handleDeletePoster(poster: Poster) {
    if (!isAdminUnlocked || isAdminBusy) {
      return;
    }

    const confirmed = window.confirm(`Delete ${formatContactForDisplay(poster.contact ?? "")}'s ${getPosterKindLabel(poster)}?`);
    if (!confirmed) {
      return;
    }

    setIsAdminBusy(true);
    try {
      await deletePoster(poster.id, adminPassword);
      setPosters((current) => current.filter((item) => item.id !== poster.id));
      setTemporaryToast({ tone: "good", message: "Poster deleted" }, 3500);
    } catch (error) {
      setToast({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not delete poster."
      });
    } finally {
      setIsAdminBusy(false);
    }
  }

  async function handleClearPosters() {
    if (!isAdminUnlocked || isAdminBusy) {
      return;
    }

    const confirmed = window.confirm("Clear every poster and graffiti from the pole?");
    if (!confirmed) {
      return;
    }

    setIsAdminBusy(true);
    try {
      await clearPosters(adminPassword);
      setPosters([]);
      setSelectedSearchIndex(0);
      setTemporaryToast({ tone: "good", message: "Pole cleared" }, 3500);
    } catch (error) {
      setToast({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not clear posters."
      });
    } finally {
      setIsAdminBusy(false);
    }
  }

  function moveSearchSelection(direction: number) {
    if (searchResults.length === 0) {
      return;
    }

    const nextIndex = (selectedSearchIndex + direction + searchResults.length) % searchResults.length;
    focusSearchResult(nextIndex);
  }

  const handlePoleViewYChange = useCallback((y: number) => {
    const normalizedY = Math.max(-1, Math.min(1, y / (POLE_HEIGHT * 0.42)));
    backgroundRef.current?.style.setProperty("--pole-bg-shift", `${normalizedY * 46}px`);
  }, []);

  return (
    <main className="relative h-dvh min-h-[640px] overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div ref={backgroundRef} className="city-backdrop" aria-hidden="true" />
        <PoleScene
          posters={posters}
          pendingPoster={pendingPoster}
          staplingPoster={staplingPoster}
          sprayingPoster={sprayingPoster}
          sprayProgress={spraySession ? spraySession.sprays / REQUIRED_SPRAYS : 1}
          focusTarget={focusTarget}
          soundEnabled={isSoundEnabled}
          onAttach={handleAttach}
          onStaple={handleStaple}
          onSpray={handleSpray}
          placementDrop={placementDrop}
          onViewYChange={handlePoleViewYChange}
          onDropMiss={() => setToast({ tone: "warn", message: "Drop it on the pole" })}
          onStapleMiss={() => setToast({ tone: "warn", message: "Click on the poster" })}
          onSprayMiss={() => setToast({ tone: "warn", message: "Spray inside the outline" })}
        />
      </div>

      <header className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between gap-3 p-4 sm:p-6">
        <div className="ct-panel-shadow pointer-events-auto border border-[#16201b]/15 bg-[#fff8e8]/80 px-4 py-3 shadow-panel backdrop-blur-md sm:px-5 sm:py-4">
          <p className="text-xs font-black uppercase text-[#1f6f55]">Posted posters</p>
          <div className="mt-1 flex items-end gap-3">
            <span className="text-5xl font-black leading-none text-[#16201b] sm:text-6xl">
              {posters.length}
            </span>
            <span className="pb-1 text-sm font-black text-[#16201b]/70">
              {isSupabaseConfigured ? "live" : "local"}
            </span>
          </div>

          {recentAdditions.length > 0 ? (
            <div className="mt-3 border-t border-[#16201b]/10 pt-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-[#16201b]/55">
                Latest additions
              </p>
              <div className="mt-2 grid gap-1.5">
                {recentAdditions.map((poster) => (
                  <button
                    key={poster.id}
                    type="button"
                    className="group max-w-[230px] text-left text-xs font-black leading-snug text-[#16201b] transition hover:translate-x-0.5 hover:text-[#1f6f55] focus:outline-none focus:ring-4 focus:ring-[#37b883]/25"
                    onClick={() =>
                      focusPoster(
                        poster,
                        `Showing ${formatContactForDisplay(poster.contact ?? "")}'s ${getPosterKindLabel(poster)}`
                      )
                    }
                  >
                    <span className="text-[#1f6f55]">{formatContactForDisplay(poster.contact ?? "")}</span>{" "}
                    <span>added {getPosterKindLabel(poster)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2 sm:flex-row">
          <button
            className="ct-button-shadow inline-flex min-h-11 items-center gap-2 border border-[#16201b] bg-white/80 px-4 py-2 text-sm font-black text-[#16201b] shadow-[4px_4px_0_#16201b] transition hover:-translate-y-0.5 hover:bg-[#cdf6de] hover:shadow-[6px_6px_0_#16201b] focus:outline-none focus:ring-4 focus:ring-[#37b883]/35"
            onClick={() => setIsSearchOpen((current) => !current)}
          >
            <Search size={18} strokeWidth={3} />
            Find poster
          </button>
          <button
            className="ct-button-shadow inline-flex min-h-11 items-center gap-2 border border-[#16201b] bg-[#ffcf57] px-4 py-2 text-sm font-black text-[#16201b] shadow-[4px_4px_0_#16201b] transition hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#16201b] focus:outline-none focus:ring-4 focus:ring-[#37b883]/35 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              setEditingPoster(null);
              setIsModalOpen(true);
            }}
            disabled={Boolean(pendingPoster) || Boolean(stapleSession) || Boolean(spraySession) || isSaving}
          >
            <Plus size={18} strokeWidth={3} />
            Add Poster
          </button>
        </div>
      </header>

      {isSearchOpen ? (
        <SearchPanel
          query={searchQuery}
          resultCount={searchResults.length}
          selectedIndex={selectedSearchIndex}
          onQueryChange={setSearchQuery}
          onSubmit={handleSearchSubmit}
          onPrevious={() => moveSearchSelection(-1)}
          onNext={() => moveSearchSelection(1)}
          onClose={() => setIsSearchOpen(false)}
        />
      ) : null}

      {pendingPoster ? (
        <PendingPlacementTray
          pendingPoster={pendingPoster}
          onCancel={() => setPendingPoster(null)}
          onEdit={() => {
            setEditingPoster(pendingPoster);
            setIsModalOpen(true);
          }}
          onDrop={(point) =>
            setPlacementDrop((current) => ({
              id: (current?.id ?? 0) + 1,
              x: point.x,
              y: point.y
            }))
          }
        />
      ) : null}

      {stapleSession ? (
        <StapleProgressCard
          count={stapleSession.staples.length}
          required={REQUIRED_STAPLES}
          onCancel={() => {
            setStapleSession(null);
            setTemporaryToast({ tone: "warn", message: "Stapling cancelled" });
          }}
        />
      ) : null}

      {spraySession ? (
        <SprayProgressCard
          count={spraySession.sprays}
          required={REQUIRED_SPRAYS}
          onCancel={() => {
            setSpraySession(null);
            setTemporaryToast({ tone: "warn", message: "Spraying cancelled" });
          }}
        />
      ) : null}


      {isAdminUnlocked ? (
        <AdminPanel
          posters={posters}
          isBusy={isAdminBusy}
          onDelete={handleDeletePoster}
          onClear={handleClearPosters}
          onClose={() => {
            setIsAdminUnlocked(false);
            setIsAdminLoginOpen(false);
            setAdminPassword("");
            setAdminError(null);
          }}
        />
      ) : isAdminLoginOpen ? (
        <AdminLoginPanel
          password={adminPassword}
          error={adminError}
          isBusy={isAdminBusy}
          onPasswordChange={(value) => {
            setAdminPassword(value);
            setAdminError(null);
          }}
          onSubmit={handleAdminLogin}
          onClose={() => {
            setIsAdminLoginOpen(false);
            setAdminError(null);
          }}
        />
      ) : null}

      {toast ? (
        <div
          className="pointer-events-none absolute bottom-4 right-4 z-20 max-w-[calc(100vw-2rem)] sm:bottom-6 sm:right-6"
          data-html2canvas-ignore="true"
        >
          <div
            className={`flex items-center gap-2 border px-3 py-2 text-sm font-bold shadow-panel ${
              toast.tone === "bad"
                ? "border-[#9f1d2f] bg-[#ffe6ea] text-[#751120]"
                : toast.tone === "warn"
                  ? "border-[#8c6219] bg-[#fff0c7] text-[#5c3f08]"
                  : "border-[#1f6f55] bg-[#e4ffed] text-[#174936]"
            }`}
          >
            {toast.tone === "bad" ? <AlertCircle size={17} /> : <Check size={17} />}
            {toast.message}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="ct-small-shadow pointer-events-auto absolute bottom-16 left-4 z-20 inline-flex size-11 items-center justify-center border border-[#16201b]/20 bg-[#fff8e8]/80 text-[#16201b] shadow-[3px_3px_0_rgba(22,32,27,0.85)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-[#cdf6de] focus:outline-none focus:ring-4 focus:ring-[#37b883]/35 sm:bottom-20 sm:left-6"
        onClick={() => setIsSoundEnabled((current) => !current)}
        aria-label={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
        title={isSoundEnabled ? "Mute sounds" : "Unmute sounds"}
      >
        {isSoundEnabled ? <Volume2 size={19} strokeWidth={3} /> : <VolumeX size={19} strokeWidth={3} />}
      </button>

      <a
        className="ct-small-shadow pointer-events-auto absolute bottom-4 left-4 z-20 border border-[#16201b]/20 bg-[#fff8e8]/80 px-3 py-2 text-xs font-black text-[#16201b] shadow-[3px_3px_0_rgba(22,32,27,0.85)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-[#cdf6de] focus:outline-none focus:ring-4 focus:ring-[#37b883]/35 sm:bottom-6 sm:left-6"
        href="https://x.com/SherhanEth"
        target="_blank"
        rel="noreferrer"
      >
        Built by @SherhanEth
      </a>

      <AddPosterModal
        open={isModalOpen}
        isSaving={isSaving}
        initialPoster={editingPoster}
        onClose={() => {
          setIsModalOpen(false);
          setEditingPoster(null);
        }}
        onCreate={handleDraftCreated}
      />
    </main>
  );
}

function SearchPanel({
  query,
  resultCount,
  selectedIndex,
  onQueryChange,
  onSubmit,
  onPrevious,
  onNext,
  onClose
}: {
  query: string;
  resultCount: number;
  selectedIndex: number;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasResults = resultCount > 0;

  return (
    <aside className="pointer-events-none absolute right-4 top-24 z-20 w-[min(390px,calc(100vw-2rem))] sm:right-6 sm:top-24">
      <form
        className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">Find poster</p>
            <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
              Search by contact
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="h-11 min-w-0 flex-1 border border-[#16201b]/25 bg-white/85 px-3 text-sm font-black text-[#16201b] outline-none transition focus:border-[#1f6f55] focus:ring-4 focus:ring-[#37b883]/25"
            value={query}
            onChange={(event) => onQueryChange(normalizeContactInput(event.currentTarget.value))}
            placeholder="@yourhandle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            className="inline-flex h-11 items-center justify-center border border-[#16201b] bg-[#37b883] px-3 text-sm font-black text-[#07130f] transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#37b883]/35"
            type="submit"
          >
            <Search size={17} strokeWidth={3} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center border border-[#16201b]/20 bg-white/70 text-[#16201b] transition hover:bg-[#cdf6de] disabled:cursor-not-allowed disabled:opacity-45"
            onClick={onPrevious}
            disabled={!hasResults}
            aria-label="Previous result"
          >
            <ChevronLeft size={18} strokeWidth={3} />
          </button>
          <span className="text-sm font-black text-[#16201b]">
            {hasResults ? `${selectedIndex + 1}/${resultCount}` : "0/0"}
          </span>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center border border-[#16201b]/20 bg-white/70 text-[#16201b] transition hover:bg-[#cdf6de] disabled:cursor-not-allowed disabled:opacity-45"
            onClick={onNext}
            disabled={!hasResults}
            aria-label="Next result"
          >
            <ChevronRight size={18} strokeWidth={3} />
          </button>
        </div>
      </form>
    </aside>
  );
}

function AdminLoginPanel({
  password,
  error,
  isBusy,
  onPasswordChange,
  onSubmit,
  onClose
}: {
  password: string;
  error: string | null;
  isBusy: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <aside className="pointer-events-none absolute right-4 top-24 z-20 w-[min(320px,calc(100vw-2rem))] sm:right-6 sm:top-[6.75rem]">
      <form
        className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">Admin mode</p>
            <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
              Enter password
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onClose}
            aria-label="Close admin login"
          >
            <X size={17} />
          </button>
        </div>

        <input
          className="mt-3 h-11 w-full border border-[#16201b]/25 bg-white/85 px-3 text-sm font-black text-[#16201b] outline-none transition focus:border-[#1f6f55] focus:ring-4 focus:ring-[#37b883]/25"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
          disabled={isBusy}
          autoFocus
          placeholder="Password"
        />

        {error ? (
          <p className="mt-2 text-xs font-black text-[#9f1d2f]">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={isBusy}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[#16201b] bg-[#37b883] px-3 py-2 text-sm font-black text-[#07130f] shadow-[3px_3px_0_#16201b] transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#37b883]/35 disabled:cursor-wait disabled:opacity-60"
        >
          <Lock size={16} strokeWidth={3} />
          {isBusy ? "Checking..." : "Unlock"}
        </button>
      </form>
    </aside>
  );
}

function AdminPanel({
  posters,
  isBusy,
  onDelete,
  onClear,
  onClose
}: {
  posters: Poster[];
  isBusy: boolean;
  onDelete: (poster: Poster) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const orderedPosters = [...posters].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );

  return (
    <aside className="pointer-events-none absolute right-4 top-24 z-20 w-[min(360px,calc(100vw-2rem))] sm:right-6 sm:top-[6.75rem]">
      <div className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">Admin tools</p>
            <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
              Moderate pole
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onClose}
            aria-label="Close admin tools"
          >
            <X size={17} />
          </button>
        </div>

        <button
          type="button"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center border border-[#9f1d2f] bg-[#ffe6ea] px-3 py-2 text-sm font-black text-[#751120] shadow-[3px_3px_0_#16201b] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={onClear}
          disabled={isBusy || posters.length === 0}
        >
          Clear all posters
        </button>

        <div className="mt-3 max-h-[40dvh] overflow-y-auto border-t border-[#16201b]/10 pt-2">
          {orderedPosters.length > 0 ? (
            <div className="grid gap-2">
              {orderedPosters.map((poster) => (
                <div
                  key={poster.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-2 border border-[#16201b]/15 bg-white/70 p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#16201b]">
                      {formatContactForDisplay(poster.contact ?? "")}
                    </p>
                    <p className="text-xs font-bold text-[#16201b]/60">
                      {getPosterKindLabel(poster)} / {new Date(poster.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center border border-[#9f1d2f]/45 bg-[#ffe6ea] px-3 text-xs font-black text-[#751120] transition hover:bg-[#ffd6de] disabled:cursor-not-allowed disabled:opacity-55"
                    onClick={() => onDelete(poster)}
                    disabled={isBusy}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-3 text-sm font-black text-[#16201b]/60">No posters yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function SprayProgressCard({
  count,
  required,
  onCancel
}: {
  count: number;
  required: number;
  onCancel: () => void;
}) {
  return (
    <aside className="pointer-events-none absolute bottom-4 right-4 z-20 w-[min(300px,calc(100vw-2rem))] sm:bottom-auto sm:right-6 sm:top-28">
      <div className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">Spray can armed</p>
            <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
              Spray inside the outline
            </p>
          </div>
          <button
            className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onCancel}
            aria-label="Cancel spraying"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {Array.from({ length: required }).map((_, index) => (
            <span
              key={index}
              className={`h-3 flex-1 border border-[#16201b]/25 ${
                index < count ? "bg-[#37b883] shadow-[2px_2px_0_#16201b]" : "bg-white/70"
              }`}
            />
          ))}
        </div>
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-black text-[#16201b]">
          <SprayCan size={16} strokeWidth={3} />
          {count}/{required} spray passes
        </p>
      </div>
    </aside>
  );
}

function StapleProgressCard({
  count,
  required,
  onCancel
}: {
  count: number;
  required: number;
  onCancel: () => void;
}) {
  return (
    <aside className="pointer-events-none absolute bottom-4 right-4 z-20 w-[min(300px,calc(100vw-2rem))] sm:bottom-auto sm:right-6 sm:top-28">
      <div className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">Stapler armed</p>
            <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
              Click 4 staples
            </p>
          </div>
          <button
            className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onCancel}
            aria-label="Cancel stapling"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {Array.from({ length: required }).map((_, index) => (
            <span
              key={index}
              className={`h-3 flex-1 border border-[#16201b]/25 ${
                index < count ? "bg-[#c8ced4] shadow-[2px_2px_0_#16201b]" : "bg-white/70"
              }`}
            />
          ))}
        </div>
        <p className="mt-3 text-sm font-black text-[#16201b]">
          {count}/{required} staples placed
        </p>
      </div>
    </aside>
  );
}

type PendingPlacementTrayProps = {
  pendingPoster: PendingPoster;
  onCancel: () => void;
  onEdit: () => void;
  onDrop: (point: { x: number; y: number }) => void;
};

function PendingPlacementTray({ pendingPoster, onCancel, onEdit, onDrop }: PendingPlacementTrayProps) {
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const isGraffiti = pendingPoster.type === "graffiti";

  useEffect(() => {
    if (!dragPosition) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "grabbing";

    function handleMove(event: globalThis.PointerEvent) {
      setDragPosition({ x: event.clientX, y: event.clientY });
    }

    function handleUp(event: globalThis.PointerEvent) {
      const point = { x: event.clientX, y: event.clientY };
      setDragPosition(null);
      onDrop(point);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleUp, { once: true });

    return () => {
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragPosition, onDrop]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragPosition({ x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <aside className="pointer-events-none absolute bottom-4 right-4 top-auto z-20 w-[min(300px,calc(100vw-2rem))] sm:bottom-auto sm:right-6 sm:top-28">
        <div className="pointer-events-auto border border-[#16201b] bg-[#fff8e8]/95 p-3 shadow-[6px_6px_0_#16201b] backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#1f6f55]">
                {isGraffiti ? "Ready graphic" : "Ready poster"}
              </p>
              <p className="mt-1 text-lg font-black leading-tight text-[#16201b]">
                Drag me onto the pole
              </p>
            </div>
            <button
              className="inline-flex size-9 shrink-0 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
              onClick={onCancel}
              aria-label="Cancel placement"
            >
              <X size={17} />
            </button>
          </div>

          <button
            type="button"
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[#16201b] bg-white/80 px-3 py-2 text-sm font-black text-[#16201b] transition hover:-translate-y-0.5 hover:bg-[#cdf6de] focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onEdit}
          >
            <Pencil size={16} strokeWidth={3} />
            Edit
          </button>

          <div
            className="mt-3 cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerCancel={() => setDragPosition(null)}
          >
            <PlacementPreview pendingPoster={pendingPoster} isFloating={false} />
          </div>

          <p className="mt-3 text-xs font-bold leading-snug text-[#16201b]/70">
            Rotate or scroll the pole, then drag this {isGraffiti ? "graphic" : "poster"} onto the spot.
          </p>
        </div>
      </aside>

      {dragPosition ? (
        <div
          className="pointer-events-none fixed z-40 w-44 -translate-x-1/2 -translate-y-1/2 cursor-grabbing opacity-90"
          style={{ left: dragPosition.x, top: dragPosition.y }}
        >
          <PlacementPreview pendingPoster={pendingPoster} isFloating />
        </div>
      ) : null}
    </>
  );
}

function PlacementPreview({
  pendingPoster,
  isFloating
}: {
  pendingPoster: PendingPoster;
  isFloating: boolean;
}) {
  const isGraffiti = pendingPoster.type === "graffiti";
  const backgroundColor = pendingPoster.color || (isGraffiti ? "transparent" : "#fff7ce");

  if (isGraffiti) {
    return (
      <div className={`${isFloating ? "" : "min-h-28"} grid place-items-center p-4`}>
        {pendingPoster.image_url ? (
          <img
            src={pendingPoster.image_url}
            alt=""
            className="max-h-32 w-full object-contain drop-shadow-[0_5px_0_rgba(8,10,10,0.35)]"
          />
        ) : null}
      </div>
    );
  }

  const previewAspect = pendingPoster.width / pendingPoster.height;
  const previewWidth = previewAspect > 1 ? "w-44" : "w-36";

  return (
    <div
      className={`mx-auto grid overflow-hidden border border-[#16201b]/20 p-[9%] text-center shadow-[0_5px_0_rgba(22,32,27,0.18)] ${previewWidth}`}
      style={{
        backgroundColor,
        aspectRatio: `${pendingPoster.width} / ${pendingPoster.height}`,
        gridTemplateRows: "9% minmax(0,1fr) 16%"
      }}
    >
      <div aria-hidden="true" />
      <div className="grid min-h-0 gap-[4%]" style={{ gridTemplateRows: pendingPoster.image_url ? "62% 30%" : "1fr" }}>
        {pendingPoster.image_url ? (
          <img src={pendingPoster.image_url} alt="" className="min-h-0 h-full w-full object-contain" />
        ) : null}
        {pendingPoster.text ? (
          <div className="min-h-0 place-self-center overflow-hidden break-words text-sm font-black leading-tight text-[#16201b]">
            {pendingPoster.text}
          </div>
        ) : null}
      </div>
      {pendingPoster.contact ? (
        <div className="grid place-items-center bg-white/20 text-sm font-black leading-tight text-[#16201b]/80">
          <span>
            <span className="block text-[10px] uppercase text-[#16201b]/55">contact:</span>
            <span className="block">{formatContactForDisplay(pendingPoster.contact)}</span>
          </span>
        </div>
      ) : <div />}
    </div>
  );
}

function normalizeRealtimePoster(value: unknown): Poster | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const poster = value as Poster;

  if (
    typeof poster.id !== "string" ||
    typeof poster.type !== "string" ||
    typeof poster.angle !== "number" ||
    typeof poster.y !== "number" ||
    typeof poster.width !== "number" ||
    typeof poster.height !== "number" ||
    typeof poster.created_at !== "string"
  ) {
    return null;
  }

  return {
    ...poster,
    staples: Array.isArray(poster.staples) ? poster.staples : []
  };
}

function getPosterKindLabel(poster: Poster) {
  return poster.type === "graffiti" ? "graffiti" : "poster";
}

function normalizeTwitterHandle(value: string) {
  const contact = normalizeContactInput(value);
  if (!contact) {
    return null;
  }

  return contact.startsWith("@") ? contact : `@${contact}`;
}

function normalizeContactSearch(value: string) {
  const contact = normalizeTwitterHandle(value);
  return contact?.toLowerCase() ?? "";
}

function normalizeContactInput(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function formatContactForDisplay(value: string) {
  return normalizeTwitterHandle(value) ?? "@unknown";
}
