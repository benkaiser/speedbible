import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

type Verse = {
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
};

type ChapterResponse = {
  reference: string;
  verses: Verse[];
  text: string;
  translation_id: string;
  translation_name: string;
  translation_note: string;
};

type AlignedWord = { w: string; s: number; e: number; v: number };
type Alignment = {
  book: string;
  chapter: number;
  audio_duration: number;
  preamble_end: number;
  audio_number: number;
  words: AlignedWord[];
};

const AUDIO_BASE_URL = `${import.meta.env.BASE_URL}audio`;

type Translation = { id: string; name: string };

const TRANSLATIONS: Translation[] = [
  { id: 'bsb',   name: 'Berean Standard Bible' },
  { id: 'kjv',   name: 'King James Version' },
  { id: 'web',   name: 'World English Bible' },
  { id: 'asv',   name: 'American Standard Version' },
  { id: 'bbe',   name: 'Bible in Basic English' },
  { id: 'darby', name: 'Darby Translation' },
  { id: 'ylt',   name: "Young's Literal Translation" },
  { id: 'dra',   name: 'Douay-Rheims American' },
];

const PROTESTANT_BOOKS: { name: string; chapters: number }[] = [
  { name: 'Genesis', chapters: 50 }, { name: 'Exodus', chapters: 40 }, { name: 'Leviticus', chapters: 27 },
  { name: 'Numbers', chapters: 36 }, { name: 'Deuteronomy', chapters: 34 }, { name: 'Joshua', chapters: 24 },
  { name: 'Judges', chapters: 21 }, { name: 'Ruth', chapters: 4 }, { name: '1 Samuel', chapters: 31 },
  { name: '2 Samuel', chapters: 24 }, { name: '1 Kings', chapters: 22 }, { name: '2 Kings', chapters: 25 },
  { name: '1 Chronicles', chapters: 29 }, { name: '2 Chronicles', chapters: 36 }, { name: 'Ezra', chapters: 10 },
  { name: 'Nehemiah', chapters: 13 }, { name: 'Esther', chapters: 10 }, { name: 'Job', chapters: 42 },
  { name: 'Psalms', chapters: 150 }, { name: 'Proverbs', chapters: 31 }, { name: 'Ecclesiastes', chapters: 12 },
  { name: 'Song of Solomon', chapters: 8 }, { name: 'Isaiah', chapters: 66 }, { name: 'Jeremiah', chapters: 52 },
  { name: 'Lamentations', chapters: 5 }, { name: 'Ezekiel', chapters: 48 }, { name: 'Daniel', chapters: 12 },
  { name: 'Hosea', chapters: 14 }, { name: 'Joel', chapters: 3 }, { name: 'Amos', chapters: 9 },
  { name: 'Obadiah', chapters: 1 }, { name: 'Jonah', chapters: 4 }, { name: 'Micah', chapters: 7 },
  { name: 'Nahum', chapters: 3 }, { name: 'Habakkuk', chapters: 3 }, { name: 'Zephaniah', chapters: 3 },
  { name: 'Haggai', chapters: 2 }, { name: 'Zechariah', chapters: 14 }, { name: 'Malachi', chapters: 4 },
  { name: 'Matthew', chapters: 28 }, { name: 'Mark', chapters: 16 }, { name: 'Luke', chapters: 24 },
  { name: 'John', chapters: 21 }, { name: 'Acts', chapters: 28 }, { name: 'Romans', chapters: 16 },
  { name: '1 Corinthians', chapters: 16 }, { name: '2 Corinthians', chapters: 13 }, { name: 'Galatians', chapters: 6 },
  { name: 'Ephesians', chapters: 6 }, { name: 'Philippians', chapters: 4 }, { name: 'Colossians', chapters: 4 },
  { name: '1 Thessalonians', chapters: 5 }, { name: '2 Thessalonians', chapters: 3 }, { name: '1 Timothy', chapters: 6 },
  { name: '2 Timothy', chapters: 4 }, { name: 'Titus', chapters: 3 }, { name: 'Philemon', chapters: 1 },
  { name: 'Hebrews', chapters: 13 }, { name: 'James', chapters: 5 }, { name: '1 Peter', chapters: 5 },
  { name: '2 Peter', chapters: 3 }, { name: '1 John', chapters: 5 }, { name: '2 John', chapters: 1 },
  { name: '3 John', chapters: 1 }, { name: 'Jude', chapters: 1 }, { name: 'Revelation', chapters: 22 },
];

function bookSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, '_');
}

function orpIndex(word: string) {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

function splitWords(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

async function fetchChapter(translation: string, book: string, chapter: number): Promise<ChapterResponse> {
  if (translation === 'bsb') {
    const slug = bookSlug(book);
    const url = `${import.meta.env.BASE_URL}bible-static/bsb/${slug}/${chapter}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BSB chapter not found (${res.status})`);
    return res.json();
  }
  const url = `https://bible-api.com/${encodeURIComponent(book)}+${chapter}?translation=${translation}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch chapter (${res.status})`);
  return res.json();
}

async function fetchAlignment(book: string, chapter: number): Promise<Alignment | null> {
  const slug = bookSlug(book);
  const url = `${import.meta.env.BASE_URL}bible-static/bsb-align/${slug}/${chapter}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'rsvpBibleBSB';
type Persisted = { book: string; chapter: number; translation: string; wpm: number; };
function loadState(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadTheme(): 'dark' | 'light' {
  try {
    const v = localStorage.getItem('rsvpBibleTheme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

// URL routing. Pathname after BASE_URL is `<book-slug>/<chapter>`, e.g.
// `/speedbible/john/3` or `/john/3` on a custom domain. Returns null if the
// URL doesn't match a chapter.
function parseRoute(): { book: string; chapter: number } | null {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length);
  const m = path.replace(/^\/+|\/+$/g, '').split('/');
  if (m.length < 2) return null;
  const slug = m[0].toLowerCase();
  const chap = parseInt(m[1], 10);
  if (!slug || !Number.isFinite(chap) || chap < 1) return null;
  const book = PROTESTANT_BOOKS.find((b) => bookSlug(b.name) === slug);
  if (!book) return null;
  if (chap > book.chapters) return null;
  return { book: book.name, chapter: chap };
}

function buildRoute(book: string, chapter: number): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${bookSlug(book)}/${chapter}`;
}

export default function App() {
  const initial = loadState();
  const route = parseRoute();
  const [translation, setTranslation] = useState(initial.translation ?? 'bsb');
  const [book, setBook] = useState(route?.book ?? initial.book ?? 'John');
  const [chapter, setChapter] = useState<number>(route?.chapter ?? initial.chapter ?? 3);
  const [wpm, setWpm] = useState<number>(initial.wpm ?? 300);
  const [theme, setTheme] = useState<'dark' | 'light'>(loadTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('rsvpBibleTheme', theme); } catch { /* ignore */ }
  }, [theme]);

  // Keep the URL in sync with book/chapter so links are shareable.
  useEffect(() => {
    const target = buildRoute(book, chapter);
    if (window.location.pathname !== target) {
      window.history.replaceState(null, '', target + window.location.search + window.location.hash);
    }
  }, [book, chapter]);

  // Handle browser back/forward.
  useEffect(() => {
    const onPop = () => {
      const r = parseRoute();
      if (r) {
        setBook(r.book);
        setChapter(r.chapter);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [verses, setVerses] = useState<Verse[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [verseMap, setVerseMap] = useState<number[]>([]);
  const [wordTimings, setWordTimings] = useState<AlignedWord[] | null>(null);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReader, setShowReader] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentWordRef = useRef<HTMLSpanElement | null>(null);

  // Audio mode is only meaningful for BSB chapters that have alignment data.
  const audioAvailable = translation === 'bsb' && alignment !== null;
  const audioActive = audioEnabled && audioAvailable;

  // Natural narration WPM, derived from alignment.
  const naturalWpm = useMemo(() => {
    if (!alignment) return 165;
    const speakingDur = alignment.audio_duration - alignment.preamble_end;
    if (speakingDur <= 0) return 165;
    return (alignment.words.length / speakingDur) * 60;
  }, [alignment]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ book, chapter, translation, wpm }));
    }, 300);
    return () => window.clearTimeout(t);
  }, [book, chapter, translation, wpm]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
    setWordIndex(0);
    setAlignment(null);
    setWordTimings(null);

    const chapterPromise = fetchChapter(translation, book, chapter);
    const alignPromise = translation === 'bsb' ? fetchAlignment(book, chapter) : Promise.resolve(null);

    Promise.all([chapterPromise, alignPromise])
      .then(([data, align]) => {
        if (cancelled) return;
        setVerses(data.verses);
        if (align) setAlignment(align);

        // If audio mode is enabled and we have alignment, source words from alignment
        // (so wordTimings line up 1:1 with words). Otherwise tokenize verses normally.
        if (align && audioEnabled) {
          setWords(align.words.map((w) => w.w));
          setVerseMap(align.words.map((w) => w.v));
          setWordTimings(align.words);
        } else {
          const allWords: string[] = [];
          const map: number[] = [];
          for (const v of data.verses) {
            for (const w of splitWords(v.text)) {
              allWords.push(w);
              map.push(v.verse);
            }
          }
          setWords(allWords);
          setVerseMap(map);
          setWordTimings(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load chapter');
        setVerses([]); setWords([]); setVerseMap([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [translation, book, chapter]);

  // When the user toggles audio mode (without reloading chapter), rebuild the
  // word stream from either alignment or splitWords on the already-loaded verses.
  useEffect(() => {
    if (verses.length === 0) return;
    if (audioEnabled && alignment) {
      setWords(alignment.words.map((w) => w.w));
      setVerseMap(alignment.words.map((w) => w.v));
      setWordTimings(alignment.words);
      setWordIndex(0);
    } else {
      const allWords: string[] = [];
      const map: number[] = [];
      for (const v of verses) {
        for (const w of splitWords(v.text)) {
          allWords.push(w);
          map.push(v.verse);
        }
      }
      setWords(allWords);
      setVerseMap(map);
      setWordTimings(null);
      setWordIndex(0);
    }
    setPlaying(false);
  }, [audioEnabled, alignment]);

  // Default RSVP timer — disabled in audio mode (audio drives the index instead).
  useEffect(() => {
    if (audioActive) return;
    if (!playing || words.length === 0) return;
    if (wordIndex >= words.length) { setPlaying(false); return; }
    const interval = 60000 / wpm;
    timerRef.current = window.setTimeout(() => {
      setWordIndex((i) => i + 1);
    }, interval);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [playing, wordIndex, wpm, words.length, audioActive]);

  // Audio mode: keep audio.playbackRate in sync with WPM.
  useEffect(() => {
    if (!audioActive || !audioRef.current) return;
    const rate = wpm / naturalWpm;
    audioRef.current.playbackRate = Math.max(0.25, Math.min(rate, 16));
  }, [wpm, audioActive, naturalWpm]);

  // Audio mode: rAF loop maps audio.currentTime → wordIndex.
  useEffect(() => {
    if (!audioActive || !wordTimings) return;
    const audio = audioRef.current;
    if (!audio) return;

    const tick = () => {
      const t = audio.currentTime;
      // Binary search for the last word whose start <= t.
      let lo = 0, hi = wordTimings.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (wordTimings[mid].s <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      setWordIndex(best);
      rafRef.current = requestAnimationFrame(tick);
    };

    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [audioActive, wordTimings, playing]);

  // Audio mode: play/pause the <audio> element when state changes.
  useEffect(() => {
    if (!audioActive || !audioRef.current) return;
    const audio = audioRef.current;
    if (playing) {
      // If we're at the start, seek past the preamble.
      if (alignment && audio.currentTime < alignment.preamble_end - 0.1) {
        audio.currentTime = alignment.preamble_end;
      }
      audio.play().catch(() => { /* ignore autoplay rejections */ });
    } else {
      audio.pause();
    }
  }, [playing, audioActive, alignment]);

  const safeIndex = Math.min(wordIndex, Math.max(0, words.length - 1));
  const currentWord = words[safeIndex] ?? '';
  const currentVerseNum = verseMap[safeIndex];
  const finished = wordIndex >= words.length && words.length > 0;

  const wordsLeft = Math.max(0, words.length - wordIndex);
  const percent = words.length > 0 ? Math.min(100, (wordIndex / words.length) * 100) : 0;
  const secondsLeft = (wordsLeft / wpm) * 60;

  const selectedBook = useMemo(
    () => PROTESTANT_BOOKS.find((b) => b.name === book) ?? PROTESTANT_BOOKS[0],
    [book]
  );

  // ----- Next chapter logic (advance to next book at end) -----
  function goNextChapter() {
    if (chapter < selectedBook.chapters) {
      setChapter(chapter + 1);
      return;
    }
    const idx = PROTESTANT_BOOKS.findIndex((b) => b.name === book);
    const next = PROTESTANT_BOOKS[idx + 1];
    if (next) {
      setBook(next.name);
      setChapter(1);
    }
  }
  const hasNextChapter =
    chapter < selectedBook.chapters ||
    PROTESTANT_BOOKS.findIndex((b) => b.name === book) < PROTESTANT_BOOKS.length - 1;

  // ----- Sentence context (4 before, current, 4 after) -----
  const ctxBefore = words.slice(Math.max(0, safeIndex - 4), safeIndex);
  const ctxAfter = words.slice(safeIndex + 1, safeIndex + 5);

  // ----- Reader view <-> playback index mapping -----
  // The reader renders the verse text as-written (punctuation intact), while the
  // playback stream may come from the alignment data, whose tokenisation differs
  // slightly. Map between them proportionally within each verse.
  const verseRanges = useMemo(() => {
    const ranges = new Map<number, { start: number; len: number }>();
    for (let i = 0; i < verseMap.length; i++) {
      const r = ranges.get(verseMap[i]);
      if (r) r.len++;
      else ranges.set(verseMap[i], { start: i, len: 1 });
    }
    return ranges;
  }, [verseMap]);

  const readerVerses = useMemo(
    () => verses.map((v) => ({ verse: v.verse, tokens: splitWords(v.text) })),
    [verses]
  );

  function wordIndexForToken(verse: number, tokenIdx: number, tokenCount: number): number | null {
    const r = verseRanges.get(verse);
    if (!r) return null;
    if (tokenCount <= 0) return r.start;
    const offset = Math.floor((tokenIdx * r.len) / tokenCount);
    return r.start + Math.min(r.len - 1, offset);
  }

  // Which reader token (verse + token index) the current playback word maps to.
  const currentToken = useMemo(() => {
    const verse = verseMap[safeIndex];
    if (verse === undefined) return null;
    const r = verseRanges.get(verse);
    const rv = readerVerses.find((x) => x.verse === verse);
    if (!r || !rv || rv.tokens.length === 0 || r.len === 0) return null;
    const offset = safeIndex - r.start;
    const idx = Math.min(rv.tokens.length - 1, Math.floor((offset * rv.tokens.length) / r.len));
    return { verse, token: idx };
  }, [safeIndex, verseMap, verseRanges, readerVerses]);

  function seekToWord(i: number) {
    setWordIndex(i);
    if (audioActive && wordTimings && audioRef.current) {
      const t = wordTimings[i]?.s;
      if (t !== undefined) audioRef.current.currentTime = t;
    }
  }

  // Keep the highlighted reader word visible while playing.
  useEffect(() => {
    if (!showReader) return;
    const el = currentWordRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center' });
    }
  }, [showReader, currentToken]);

  const playbackControls = (
    <>
      <SeekBar
        wordIndex={wordIndex}
        totalWords={words.length}
        verseMap={verseMap}
        book={book}
        chapter={chapter}
        onSeek={seekToWord}
        onSeekStart={() => {
          // In audio mode the rAF loop keeps the displayed word in sync
          // with audio.currentTime, which we update on every drag move,
          // so we can keep playing while seeking. In RSVP-only mode the
          // timer would race the drag, so pause then.
          if (!audioActive) setPlaying(false);
        }}
      />

      <div className="speed-row">
        <span className="muted small">Speed</span>
        <input
          type="range" min={100} max={1000} step={10}
          value={wpm} onChange={(e) => setWpm(Number(e.target.value))}
        />
        <span className="speed-value">
          {wpm} WPM
          {audioActive && (
            <span className="audio-rate">{` · ${(wpm / naturalWpm).toFixed(2)}× audio`}</span>
          )}
        </span>
      </div>

      <div className="actions">
        <button
          className="circ"
          onClick={() => {
            setWordIndex(0);
            setPlaying(false);
            if (audioActive && audioRef.current && alignment) {
              audioRef.current.currentTime = alignment.preamble_end;
            }
          }}
          disabled={loading}
          title="Restart chapter"
          aria-label="Restart chapter"
        >↺</button>

        <button
          className="play"
          disabled={loading || words.length === 0}
          onClick={() => {
            if (finished) {
              setWordIndex(0);
              if (audioActive && audioRef.current && alignment) {
                audioRef.current.currentTime = alignment.preamble_end;
              }
            }
            setPlaying((p) => !p);
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <button
          className="circ"
          onClick={goNextChapter}
          disabled={loading || !hasNextChapter}
          title="Next chapter"
          aria-label="Next chapter"
        >
          <span className="next-ch">Next<br/>Ch</span>
        </button>
      </div>

      <div className="stats">
        {Math.round(percent)}% &nbsp;·&nbsp; {wpm} WPM &nbsp;·&nbsp; {wordsLeft} words left &nbsp;·&nbsp; {formatDuration(secondsLeft)} remaining
      </div>
    </>
  );

  return (
    <>
      <header>
        <div>
          <h1>SpeedBible</h1>
          <div className="muted small">
            Speed-read Scripture · {verses.length > 0 && currentVerseNum !== undefined
              ? `${book} ${chapter}:${currentVerseNum}`
              : `${book} ${chapter}`}
          </div>
        </div>
        <div className="header-right">
          <span className="muted small">{translation.toUpperCase()}</span>
          {audioAvailable && (
            <button
              className={'audio-toggle' + (audioEnabled ? ' is-on' : '')}
              aria-pressed={audioEnabled}
              title={audioEnabled ? 'Disable audio (use RSVP timing)' : 'Enable audio (synced narration)'}
              onClick={() => setAudioEnabled((a) => !a)}
            >
              {audioEnabled ? '🔊 Audio' : '🔈 Audio'}
            </button>
          )}
          <button
            className="theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {audioActive && alignment && (
        // preload="none" is critical for offline support: each MP3 is ~1 MB
        // and the full BSB narration is 1.2 GB, so we never preload audio. The
        // service worker's CacheFirst rule lazy-caches each chapter the first
        // time it's actually played, after which it's available offline.
        <audio
          ref={audioRef}
          src={`${AUDIO_BASE_URL}/${alignment.audio_number}.mp3`}
          preload="none"
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const a = e.currentTarget as HTMLAudioElement & { preservesPitch?: boolean };
            a.preservesPitch = true;
          }}
        />
      )}

      <div className="controls">
        <label className="field">
          <span>Translation</span>
          <select value={translation} onChange={(e) => setTranslation(e.target.value)}>
            {TRANSLATIONS.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </label>
        <div className="field">
          <span>Passage</span>
          <button
            type="button"
            className="passage-button"
            onClick={() => setPickerOpen(true)}
            aria-haspopup="dialog"
          >
            {book} {chapter}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <PassagePicker
          books={PROTESTANT_BOOKS}
          currentBook={book}
          currentChapter={chapter}
          onSelect={(b, c) => { setBook(b); setChapter(c); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {error && <div className="error">{error}</div>}

      {!showReader ? (
        <>
          <div className="stage">
            {loading ? (
              <div className="muted">Loading...</div>
            ) : (
              <>
                <RsvpWord word={currentWord} />
                <div className="context">
                  <span className="ctx-faded">{ctxBefore.join(' ')}</span>
                  <span className="ctx-current"> {currentWord} </span>
                  <span className="ctx-faded">{ctxAfter.join(' ')}</span>
                </div>
              </>
            )}
          </div>

          {playbackControls}

          <div className="actions secondary">
            <button onClick={() => setShowReader(true)}>Reader View</button>
          </div>
        </>
      ) : (
        <>
          <div className="reader">
            {verses.length === 0 && !loading && <p className="muted">No verses.</p>}
            {readerVerses.map((v) => (
              <span key={v.verse} className="reader-verse">
                <sup>{v.verse}</sup>
                {v.tokens.map((token, i) => {
                  const isCurrent = currentToken?.verse === v.verse && currentToken.token === i;
                  return (
                    <Fragment key={i}>
                      <span
                        ref={isCurrent ? currentWordRef : undefined}
                        className={'reader-word' + (isCurrent ? ' is-current' : '')}
                        onClick={() => {
                          const idx = wordIndexForToken(v.verse, i, v.tokens.length);
                          if (idx !== null) seekToWord(idx);
                        }}
                        title={`Jump to ${book} ${chapter}:${v.verse}`}
                      >
                        {token}
                      </span>{' '}
                    </Fragment>
                  );
                })}
              </span>
            ))}
          </div>

          {playbackControls}

          <div className="actions secondary">
            <button onClick={() => setShowReader(false)}>RSVP View</button>
          </div>
        </>
      )}

      <p className="muted small footer-note">
        SpeedBible uses RSVP (Rapid Serial Visual Presentation) — words flash one at a time
        with the optimal recognition point fixed in place, so your eyes stay still. Try 350 WPM
        to start, then push higher. BSB is bundled offline; other translations stream from bible-api.com.
      </p>
    </>
  );
}

function RsvpWord({ word }: { word: string }) {
  const idx = orpIndex(word);
  const before = word.slice(0, idx);
  const orp = word.slice(idx, idx + 1);
  const after = word.slice(idx + 1);

  // Column-lock the ORP: each side cell gets ~half the container. Scale font
  // size so the longer half fits without wrapping. JetBrains Mono advance
  // width is ~0.62em.
  const halfChars = Math.max(before.length, after.length) + 1;
  const containerPx = 600; // matches CSS max-width
  const maxFontPx = Math.min(54, (containerPx * 0.46) / (halfChars * 0.62));
  const fontPx = Math.max(20, maxFontPx);

  return (
    <div className="rsvp-word" aria-live="polite" style={{ fontSize: `${fontPx}px` }}>
      <span className="before">{before}</span>
      <span className="orp">{orp || '\u00A0'}</span>
      <span className="after">{after}</span>
    </div>
  );
}

function PassagePicker({
  books, currentBook, currentChapter, onSelect, onClose,
}: {
  books: { name: string; chapters: number }[];
  currentBook: string;
  currentChapter: number;
  onSelect: (book: string, chapter: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeBook, setActiveBook] = useState(currentBook);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    // Match either book name or its initials (e.g. "1c" -> "1 Corinthians")
    return books.filter((b) => {
      const name = b.name.toLowerCase();
      if (name.includes(q)) return true;
      // ordinal handling: "1c" should match "1 corinthians"
      const compact = name.replace(/\s+/g, '');
      if (compact.includes(q.replace(/\s+/g, ''))) return true;
      return false;
    });
  }, [query, books]);

  // While searching, follow the top filter result so the chapter grid updates live
  useEffect(() => {
    if (query.trim() === '') return;
    if (filtered.length === 0) return;
    if (!filtered.some((b) => b.name === activeBook)) {
      setActiveBook(filtered[0].name);
    }
  }, [filtered, query, activeBook]);

  const activeBookData =
    books.find((b) => b.name === activeBook) ?? filtered[0] ?? books[0];

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose passage">
        <div className="picker-header">
          <div className="picker-search">
            <span className="picker-search-icon" aria-hidden>⌕</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search books..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  setActiveBook(filtered[0].name);
                }
              }}
            />
          </div>
          <button className="picker-close" onClick={onClose}>Close</button>
        </div>
        <div className="picker-body">
          <ul className="picker-books" role="listbox">
            {filtered.length === 0 && <li className="picker-empty">No books match.</li>}
            {filtered.map((b) => (
              <li
                key={b.name}
                role="option"
                aria-selected={b.name === activeBookData.name}
                className={
                  'picker-book' +
                  (b.name === activeBookData.name ? ' is-active' : '') +
                  (b.name === currentBook ? ' is-current' : '')
                }
                onClick={() => setActiveBook(b.name)}
              >
                {b.name}
              </li>
            ))}
          </ul>
          <div className="picker-chapters">
            <div className="picker-book-title">{activeBookData.name.toUpperCase()}</div>
            <div className="picker-chapter-grid">
              {Array.from({ length: activeBookData.chapters }, (_, i) => i + 1).map((n) => {
                const isCurrent = activeBookData.name === currentBook && n === currentChapter;
                return (
                  <button
                    key={n}
                    className={'picker-chapter' + (isCurrent ? ' is-current' : '')}
                    onClick={() => onSelect(activeBookData.name, n)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeekBar({
  wordIndex, totalWords, verseMap, book, chapter, onSeek, onSeekStart,
}: {
  wordIndex: number;
  totalWords: number;
  verseMap: number[];
  book: string;
  chapter: number;
  onSeek: (idx: number) => void;
  onSeekStart: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function indexFromEvent(clientX: number): number {
    const el = trackRef.current; if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.min(totalWords - 1, Math.max(0, Math.round(ratio * totalWords)));
  }

  function pos(clientX: number): number {
    const el = trackRef.current; if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, clientX - rect.left));
  }

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const idx = indexFromEvent(e.clientX);
      onSeek(idx);
      setHover({ x: pos(e.clientX), idx });
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, totalWords]);

  const percent = totalWords > 0 ? (wordIndex / totalWords) * 100 : 0;
  const tipIdx = hover ? hover.idx : wordIndex;
  const tipVerse = verseMap[Math.min(tipIdx, verseMap.length - 1)] ?? 1;

  return (
    <div className="seek-wrap">
      <div
        className="seek-track"
        ref={trackRef}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          onSeekStart();
          setDragging(true);
          const idx = indexFromEvent(e.clientX);
          onSeek(idx);
          setHover({ x: pos(e.clientX), idx });
        }}
        onPointerMove={(e) => {
          if (totalWords === 0) return;
          const idx = indexFromEvent(e.clientX);
          setHover({ x: pos(e.clientX), idx });
        }}
        onPointerLeave={() => { if (!dragging) setHover(null); }}
      >
        <div className="seek-fill" style={{ width: `${percent}%` }} />
        {hover && totalWords > 0 && (
          <div className="seek-tooltip" style={{ left: hover.x }}>
            {book} {chapter}:{tipVerse}
          </div>
        )}
      </div>
    </div>
  );
}
