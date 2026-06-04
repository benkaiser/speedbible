import { useEffect, useMemo, useRef, useState } from 'react';

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

export default function App() {
  const initial = loadState();
  const [translation, setTranslation] = useState(initial.translation ?? 'bsb');
  const [book, setBook] = useState(initial.book ?? 'John');
  const [chapter, setChapter] = useState<number>(initial.chapter ?? 3);
  const [wpm, setWpm] = useState<number>(initial.wpm ?? 300);
  const [theme, setTheme] = useState<'dark' | 'light'>(loadTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('rsvpBibleTheme', theme); } catch { /* ignore */ }
  }, [theme]);

  const [verses, setVerses] = useState<Verse[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [verseMap, setVerseMap] = useState<number[]>([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReader, setShowReader] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const timerRef = useRef<number | null>(null);

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
    fetchChapter(translation, book, chapter)
      .then((data) => {
        if (cancelled) return;
        setVerses(data.verses);
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
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load chapter');
        setVerses([]); setWords([]); setVerseMap([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [translation, book, chapter]);

  useEffect(() => {
    if (!playing || words.length === 0) return;
    if (wordIndex >= words.length) { setPlaying(false); return; }
    const interval = 60000 / wpm;
    timerRef.current = window.setTimeout(() => {
      setWordIndex((i) => i + 1);
    }, interval);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [playing, wordIndex, wpm, words.length]);

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

          <SeekBar
            wordIndex={wordIndex}
            totalWords={words.length}
            verseMap={verseMap}
            book={book}
            chapter={chapter}
            onSeek={(i) => { setWordIndex(i); }}
            onSeekStart={() => setPlaying(false)}
          />

          <div className="speed-row">
            <span className="muted small">Speed</span>
            <input
              type="range" min={100} max={1000} step={10}
              value={wpm} onChange={(e) => setWpm(Number(e.target.value))}
            />
            <span className="speed-value">{wpm} WPM</span>
          </div>

          <div className="actions">
            <button
              className="circ"
              onClick={() => { setWordIndex(0); setPlaying(false); }}
              disabled={loading}
              title="Restart chapter"
              aria-label="Restart chapter"
            >↺</button>

            <button
              className="play"
              disabled={loading || words.length === 0}
              onClick={() => {
                if (finished) setWordIndex(0);
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

          <div className="actions secondary">
            <button onClick={() => setShowReader(true)}>Reader View</button>
          </div>
        </>
      ) : (
        <>
          <div className="reader">
            {verses.length === 0 && !loading && <p className="muted">No verses.</p>}
            {verses.map((v) => (
              <span
                key={v.verse}
                className="reader-verse"
                onClick={() => {
                  const idx = verseMap.indexOf(v.verse);
                  if (idx >= 0) setWordIndex(idx);
                  setPlaying(false);
                  setShowReader(false);
                }}
                title={`Jump to ${book} ${chapter}:${v.verse} in RSVP view`}
              >
                <sup>{v.verse}</sup>{v.text.trim()}{' '}
              </span>
            ))}
          </div>
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
