import { useEffect, useMemo, useState } from "react";

import { fetchAyah, fetchHealth, fetchSegmenterHealth, getApiBase, getSegmenterBase } from "./api";
import { useRecitation } from "./hooks/useRecitation";

const SURAHS = [
  { number: 1, name: "Al-Fatiha", nameAr: "الفاتحة", verses: 7, difficulty: "Beginner", juz: 1 },
  { number: 67, name: "Al-Mulk", nameAr: "الملك", verses: 30, difficulty: "Intermediate", juz: 29 },
  { number: 78, name: "An-Naba", nameAr: "النبأ", verses: 40, difficulty: "Intermediate", juz: 30 },
  { number: 112, name: "Al-Ikhlas", nameAr: "الإخلاص", verses: 4, difficulty: "Beginner", juz: 30 },
  { number: 113, name: "Al-Falaq", nameAr: "الفلق", verses: 5, difficulty: "Beginner", juz: 30 },
  { number: 114, name: "An-Nas", nameAr: "الناس", verses: 6, difficulty: "Beginner", juz: 30 },
];

const CAPABILITIES = [
  {
    key: "muaalem",
    title: "Phoneme-aware correction",
    titleAr: "تصحيح صوتي واعٍ بالفونيمات",
    body: "The Muaalem backend listens for phoneme substitutions and maps them back to tajweed and articulation feedback.",
  },
  {
    key: "dsp",
    title: "DSP rule checks",
    titleAr: "فحوصات رقمية مباشرة",
    body: "Madd, ghunnah, and qalqalah stay deterministic with duration, nasal energy, and burst heuristics instead of unnecessary model training.",
  },
  {
    key: "ayah",
    title: "Ayah-based practice",
    titleAr: "تدريب على مستوى الآية",
    body: "The experience is organized around complete ayah context, because the backend is more reliable when it hears connected recitation.",
  },
];

const RULES = [
  { name: "Tafkheem", nameAr: "تفخيم" },
  { name: "Makhraj", nameAr: "مخرج" },
  { name: "Madd", nameAr: "مد" },
  { name: "Ghunnah", nameAr: "غنة" },
  { name: "Qalqalah", nameAr: "قلقلة" },
];

const MAKHARIJ = [
  { letter: "ق", latin: "Qaaf", origin: "Deep tongue against the soft palate", originAr: "أقصى اللسان مع الحنك اللين" },
  { letter: "ع", latin: "Ayn", origin: "Middle throat constriction", originAr: "وسط الحلق" },
  { letter: "ح", latin: "Haa", origin: "Open middle throat airflow", originAr: "وسط الحلق مع همس" },
  { letter: "ص", latin: "Saad", origin: "Tongue tip with elevated emphasis", originAr: "طرف اللسان مع الاستعلاء" },
  { letter: "ض", latin: "Daad", origin: "Side tongue against upper molars", originAr: "حافة اللسان مع الأضراس العليا" },
  { letter: "ط", latin: "Taa", origin: "Heavy stop at the gum ridge", originAr: "طرف اللسان مع اللثة بتفخيم" },
  { letter: "م", latin: "Meem", origin: "Closed lips with nasal resonance", originAr: "انطباق الشفتين مع غنة" },
  { letter: "ن", latin: "Noon", origin: "Tongue tip with nasal outlet", originAr: "طرف اللسان مع الخيشوم" },
];

function loadStoredProgress() {
  if (typeof window === "undefined") {
    return { sessions: 0, totalMinutes: 0, bestScore: 0, summaries: [] };
  }
  try {
    const raw = window.localStorage.getItem("tajweed-progress-v1");
    return raw ? JSON.parse(raw) : { sessions: 0, totalMinutes: 0, bestScore: 0, summaries: [] };
  } catch {
    return { sessions: 0, totalMinutes: 0, bestScore: 0, summaries: [] };
  }
}

function persistProgress(progress) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem("tajweed-progress-v1", JSON.stringify(progress));
}

function formatAyah(words) {
  return (words || []).join(" ");
}

function inferDifficultyColor(level) {
  if (level === "Beginner") {
    return "var(--emerald)";
  }
  if (level === "Intermediate") {
    return "var(--gold)";
  }
  return "var(--clay)";
}

function WaveBars({ active }) {
  return (
    <div className={`wave ${active ? "wave--active" : ""}`}>
      {Array.from({ length: 28 }).map((_, index) => (
        <span
          key={index}
          style={{ animationDelay: `${index * 45}ms` }}
        />
      ))}
    </div>
  );
}

function RulePill({ label, arabic }) {
  return (
    <span className="rule-pill">
      <strong>{arabic}</strong>
      <span>{label}</span>
    </span>
  );
}

export default function App() {
  const [view, setView] = useState("home");
  const [selectedSurah, setSelectedSurah] = useState(SURAHS[0]);
  const [currentAyah, setCurrentAyah] = useState(1);
  const [ayahPayload, setAyahPayload] = useState({ words: [], word_audio_urls: [] });
  const [loadingAyah, setLoadingAyah] = useState(true);
  const [backendHealth, setBackendHealth] = useState(null);
  const [segmenterHealth, setSegmenterHealth] = useState(null);
  const [backendError, setBackendError] = useState("");
  const [segmenterError, setSegmenterError] = useState("");
  const [sessionState, setSessionState] = useState({ status: "idle" });
  const [latestCorrection, setLatestCorrection] = useState(null);
  const [latestSummary, setLatestSummary] = useState(null);
  const [eventFeed, setEventFeed] = useState([]);
  const [progress, setProgress] = useState(loadStoredProgress);

  const apiBase = getApiBase();
  const segmenterBase = getSegmenterBase();

  useEffect(() => {
    persistProgress(progress);
  }, [progress]);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      try {
        const payload = await fetchHealth();
        if (!cancelled) {
          setBackendHealth(payload);
          setBackendError("");
        }
      } catch (error) {
        if (!cancelled) {
          setBackendError(String(error.message || error));
        }
      }
    }
    loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSegmenterHealth() {
      try {
        const payload = await fetchSegmenterHealth();
        if (!cancelled) {
          setSegmenterHealth(payload);
          setSegmenterError("");
        }
      } catch (error) {
        if (!cancelled) {
          setSegmenterError(String(error.message || error));
        }
      }
    }
    loadSegmenterHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAyahPayload() {
      setLoadingAyah(true);
      try {
        const payload = await fetchAyah(selectedSurah.number, currentAyah);
        if (!cancelled) {
          setAyahPayload(payload);
          setBackendError("");
        }
      } catch (error) {
        if (!cancelled) {
          setAyahPayload({ words: [], word_audio_urls: [] });
          setBackendError(String(error.message || error));
        }
      } finally {
        if (!cancelled) {
          setLoadingAyah(false);
        }
      }
    }
    loadAyahPayload();
    return () => {
      cancelled = true;
    };
  }, [currentAyah, selectedSurah.number]);

  const addFeedItem = (item) => {
    setEventFeed((current) => [item, ...current].slice(0, 8));
  };

  const recitation = useRecitation({
    surah: selectedSurah.number,
    ayah: currentAyah,
    onReady: (message) => {
      addFeedItem({
        kind: "ready",
        title: "Session ready",
        titleAr: "الجلسة جاهزة",
        body: `${message.total_words} words loaded for this ayah.`,
      });
    },
    onCorrection: (message) => {
      setLatestCorrection(message);
      addFeedItem({
        kind: "correction",
        title: message.rule || "Correction",
        titleAr: message.word_ar || "تصحيح",
        body: message.description,
      });
    },
    onCorrect: (message) => {
      addFeedItem({
        kind: "correct",
        title: "Correct so far",
        titleAr: "القراءة سليمة حتى الآن",
        body: `Word index ${message.word_index} passed the current window.`,
      });
    },
    onSummary: (message) => {
      setLatestSummary(message);
      setLatestCorrection(null);
      setProgress((current) => {
        const next = {
          sessions: current.sessions + 1,
          totalMinutes: current.totalMinutes + 2,
          bestScore: Math.max(current.bestScore, message.score || 0),
          summaries: [
            {
              score: message.score,
              errors: message.total_errors,
              surah: selectedSurah.number,
              ayah: currentAyah,
              createdAt: new Date().toISOString(),
            },
            ...current.summaries,
          ].slice(0, 12),
        };
        return next;
      });
      addFeedItem({
        kind: "summary",
        title: `Score ${message.score}`,
        titleAr: "ملخص التلاوة",
        body: `${message.total_errors} detected issues in this pass.`,
      });
    },
    onStateChange: setSessionState,
  });

  const ayahText = useMemo(() => formatAyah(ayahPayload.words), [ayahPayload.words]);
  const difficultyColor = inferDifficultyColor(selectedSurah.difficulty);

  const nextAyah = () => {
    setCurrentAyah((current) => Math.min(selectedSurah.verses, current + 1));
    setLatestCorrection(null);
    setLatestSummary(null);
  };

  const previousAyah = () => {
    setCurrentAyah((current) => Math.max(1, current - 1));
    setLatestCorrection(null);
    setLatestSummary(null);
  };

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb--top" />
      <div className="bg-orb bg-orb--side" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">﷽</span>
          <div>
            <p className="eyebrow">AI Quran Recitation Coach</p>
            <h1>الترتيل · Al Tarteel</h1>
          </div>
        </div>

        <nav className="nav-tabs">
          {[
            ["home", "Overview"],
            ["practice", "Practice"],
            ["makharij", "Makhaarij"],
            ["journey", "Journey"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "nav-tab nav-tab--active" : "nav-tab"}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {view === "home" && (
        <main className="page page--home">
          <section className="hero-card">
            <div className="hero-copy">
              <p className="eyebrow">Recite with context, not just isolated clips</p>
              <h2>Build fluent tilawah with bilingual guidance and real feedback.</h2>
              <p className="hero-text">
                Practice complete ayahs, hear correction audio, and review tajweed issues in English
                and Arabic. The interface is designed around what the backend actually does well:
                connected recitation, rule-specific feedback, and clear playback loops.
              </p>
              <div className="hero-actions">
                <button className="button button--primary" onClick={() => setView("practice")}>
                  Open the recitation studio
                </button>
                <button className="button button--ghost" onClick={() => setView("makharij")}>
                  Explore articulation points
                </button>
              </div>
            </div>

            <aside className="hero-status">
              <div className="status-card">
                <span className="status-label">Backend</span>
                <strong>{backendHealth?.status === "ok" ? "Connected" : "Checking"}</strong>
                <p>{backendHealth?.model || backendError || "Waiting for health check response."}</p>
              </div>
              <div className="status-card">
                <span className="status-label">Segmenter</span>
                <strong>{segmenterHealth?.status === "ok" ? "Connected" : "Checking"}</strong>
                <p>
                  {segmenterHealth?.service === "segmenter"
                    ? "Dedicated Cloud Run segmenter service is ready."
                    : segmenterError || "Waiting for segmenter health check response."}
                </p>
              </div>
              <div className="status-card">
                <span className="status-label">Deployment split</span>
                <strong>Railway + Cloud Run</strong>
                <p>Frontend stays on Railway while backend and segmenter run as separate Cloud Run GPU services.</p>
              </div>
              <div className="status-card">
                <span className="status-label">Live endpoint</span>
                <strong>{apiBase}</strong>
                <p>Set backend, websocket, and segmenter URLs in Railway for production deployment.</p>
                <small>{segmenterBase}</small>
              </div>
            </aside>
          </section>

          <section className="capability-grid">
            {CAPABILITIES.map((item) => (
              <article key={item.key} className="capability-card">
                <span className="capability-ar">{item.titleAr}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </section>

          <section className="overview-grid">
            <article className="panel">
              <div className="panel-heading">
                <h3>Supported focus areas</h3>
                <p>مدروس للقراءة المتصلة والتغذية الراجعة الفورية</p>
              </div>
              <div className="rule-row">
                {RULES.map((rule) => (
                  <RulePill key={rule.name} label={rule.name} arabic={rule.nameAr} />
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <h3>Ready-to-practice surahs</h3>
                <p>Select a guided path, then move into the live studio.</p>
              </div>
              <div className="surah-list">
                {SURAHS.slice(0, 4).map((surah) => (
                  <button
                    key={surah.number}
                    className="surah-row"
                    onClick={() => {
                      setSelectedSurah(surah);
                      setCurrentAyah(1);
                      setView("practice");
                    }}
                  >
                    <div>
                      <strong>{surah.name}</strong>
                      <span>{surah.verses} ayahs · Juz {surah.juz}</span>
                    </div>
                    <div className="surah-meta">
                      <span className="surah-ar">{surah.nameAr}</span>
                      <span className="badge" style={{ color: inferDifficultyColor(surah.difficulty) }}>
                        {surah.difficulty}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </article>
          </section>
        </main>
      )}

      {view === "practice" && (
        <main className="page page--practice">
          <section className="practice-layout">
            <aside className="practice-sidebar panel">
              <div className="panel-heading">
                <h3>Surah Library</h3>
                <p>السور المختارة للتدريب</p>
              </div>
              <div className="surah-list">
                {SURAHS.map((surah) => (
                  <button
                    key={surah.number}
                    className={selectedSurah.number === surah.number ? "surah-row surah-row--active" : "surah-row"}
                    onClick={() => {
                      setSelectedSurah(surah);
                      setCurrentAyah(1);
                      setLatestCorrection(null);
                      setLatestSummary(null);
                    }}
                  >
                    <div>
                      <strong>{surah.name}</strong>
                      <span>{surah.verses} ayahs · Juz {surah.juz}</span>
                    </div>
                    <div className="surah-meta">
                      <span className="surah-ar">{surah.nameAr}</span>
                      <span className="badge" style={{ color: inferDifficultyColor(surah.difficulty) }}>
                        {surah.difficulty}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <section className="practice-main">
              <article className="panel ayah-panel">
                <div className="practice-header">
                  <div>
                    <span className="eyebrow">Practice Studio</span>
                    <h2>
                      {selectedSurah.nameAr} · {selectedSurah.name}
                    </h2>
                    <p>
                      Ayah {currentAyah} of {selectedSurah.verses}
                    </p>
                  </div>
                  <div className="practice-meta">
                    <span className="badge" style={{ color: difficultyColor }}>
                      {selectedSurah.difficulty}
                    </span>
                    <span className="badge">
                      {recitation.isConnected ? "Live socket ready" : "Socket idle"}
                    </span>
                  </div>
                </div>

                <div className="ayah-card">
                  {loadingAyah ? (
                    <p className="muted">Loading ayah text…</p>
                  ) : ayahText ? (
                    <>
                      <p className="ayah-ar">{ayahText}</p>
                      <div className="word-grid">
                        {ayahPayload.words.map((word, index) => (
                          <span key={`${word}-${index}`} className="word-chip">
                            <span>{index + 1}</span>
                            <strong>{word}</strong>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">No ayah data returned for this selection.</p>
                  )}
                </div>

                <div className="control-row">
                  <button className="button button--ghost" onClick={previousAyah} disabled={currentAyah === 1}>
                    Previous ayah
                  </button>
                  {!recitation.isRecording ? (
                    <button className="button button--primary" onClick={recitation.startRecording}>
                      Start live recitation
                    </button>
                  ) : (
                    <button className="button button--danger" onClick={recitation.stopRecording}>
                      Stop and review
                    </button>
                  )}
                  <button
                    className="button button--ghost"
                    onClick={nextAyah}
                    disabled={currentAyah === selectedSurah.verses}
                  >
                    Next ayah
                  </button>
                </div>

                <div className="live-strip">
                  <div>
                    <span className="status-label">Session state</span>
                    <strong>{sessionState.status || "idle"}</strong>
                  </div>
                  <div>
                    <span className="status-label">Connection</span>
                    <strong>{recitation.connectionError || (recitation.isConnected ? "Stable" : "Waiting")}</strong>
                  </div>
                </div>

                <WaveBars active={recitation.isRecording} />
              </article>

              <div className="feedback-grid">
                <article className="panel">
                  <div className="panel-heading">
                    <h3>Latest correction</h3>
                    <p>آخر ملاحظة أثناء التلاوة</p>
                  </div>
                  {latestCorrection ? (
                    <div className="feedback-card feedback-card--warning">
                      <div className="feedback-topline">
                        <strong>{latestCorrection.word_ar || "Correction"}</strong>
                        <span>{latestCorrection.rule || latestCorrection.error_type}</span>
                      </div>
                      <p>{latestCorrection.description}</p>
                      {latestCorrection.audio_url ? (
                        <audio controls src={latestCorrection.audio_url} className="audio-player">
                          Your browser does not support audio playback.
                        </audio>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted">No correction yet. Start reciting to receive live feedback.</p>
                  )}
                </article>

                <article className="panel">
                  <div className="panel-heading">
                    <h3>Latest summary</h3>
                    <p>ملخص الأداء بعد الإيقاف</p>
                  </div>
                  {latestSummary ? (
                    <div className="summary-block">
                      <div className="score-ring">
                        <span>{latestSummary.score}</span>
                      </div>
                      <div>
                        <strong>{latestSummary.total_errors} flagged issues</strong>
                        <p>Use the event stream below to inspect recent corrections and move to the next ayah.</p>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">The backend will send a summary after you stop recording.</p>
                  )}
                </article>
              </div>

              <article className="panel">
                <div className="panel-heading">
                  <h3>Event stream</h3>
                  <p>Live backend messages from the WebSocket session</p>
                </div>
                <div className="feed-list">
                  {eventFeed.length ? (
                    eventFeed.map((item, index) => (
                      <div key={`${item.kind}-${index}`} className="feed-item">
                        <div className="feed-head">
                          <strong>{item.title}</strong>
                          <span>{item.titleAr}</span>
                        </div>
                        <p>{item.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No session events yet.</p>
                  )}
                </div>
              </article>
            </section>
          </section>
        </main>
      )}

      {view === "makharij" && (
        <main className="page">
          <section className="panel">
            <div className="panel-heading">
              <h2>Makhaarij Reference</h2>
              <p>مخارج الحروف الأساسية المرتبطة بالتغذية الراجعة الحالية</p>
            </div>
            <div className="makharij-grid">
              {MAKHARIJ.map((item) => (
                <article key={item.letter} className="makhraj-card">
                  <span className="makhraj-letter">{item.letter}</span>
                  <div>
                    <h3>{item.latin}</h3>
                    <p>{item.origin}</p>
                    <p className="makhraj-ar">{item.originAr}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      {view === "journey" && (
        <main className="page">
          <section className="journey-grid">
            <article className="panel">
              <div className="panel-heading">
                <h2>Practice Journey</h2>
                <p>ملخص جلساتك الأخيرة</p>
              </div>
              <div className="metrics-grid">
                <div className="metric-card">
                  <strong>{progress.sessions}</strong>
                  <span>Sessions</span>
                </div>
                <div className="metric-card">
                  <strong>{progress.totalMinutes}</strong>
                  <span>Tracked minutes</span>
                </div>
                <div className="metric-card">
                  <strong>{progress.bestScore}</strong>
                  <span>Best score</span>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <h2>Recent summaries</h2>
                <p>آخر الجلسات المحفوظة محلياً</p>
              </div>
              <div className="feed-list">
                {progress.summaries.length ? (
                  progress.summaries.map((summary, index) => (
                    <div key={`${summary.createdAt}-${index}`} className="feed-item">
                      <div className="feed-head">
                        <strong>
                          Surah {summary.surah}, Ayah {summary.ayah}
                        </strong>
                        <span>Score {summary.score}</span>
                      </div>
                      <p>{summary.errors} issues detected in this saved session.</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">No local summaries yet. Complete one recording session to populate this panel.</p>
                )}
              </div>
            </article>
          </section>
        </main>
      )}
    </div>
  );
}
