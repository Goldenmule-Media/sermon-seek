// Real snippets from apps/worker/.cache/videos/*/captions.vtt
// Each snippet is lowercase ASR text paired with expected refs.
// verse_end: -1 means chapter-only (whole chapter); the extractor sets verse_end to max_verse.

export interface FixtureRef {
  book_id: number
  chapter_start: number
  verse_start: number
  chapter_end: number
  verse_end: number // -1 = chapter-only (only book_id, chapter_start, verse_start=1 checked)
}

export interface Fixture {
  snippet: string
  expected: FixtureRef[]
}

export const FIXTURES: Fixture[] = [
  // aaBUA2xjAkE/captions.vtt — "first corinthians 9 verse 19" (keyword form)
  {
    snippet: "and read first corinthians 9 verse 19.",
    expected: [{ book_id: 46, chapter_start: 9, verse_start: 19, chapter_end: 9, verse_end: 19 }],
  },

  // aaBUA2xjAkE/captions.vtt — "john 10 18" (space separator)
  {
    snippet: "as we can read in john 10 18 jesus says",
    expected: [{ book_id: 43, chapter_start: 10, verse_start: 18, chapter_end: 10, verse_end: 18 }],
  },

  // 7evttd0jJzc/captions.vtt — required: "first corinthians 10 13" (space separator + ordinal)
  {
    snippet: "first corinthians 10 13 says",
    expected: [{ book_id: 46, chapter_start: 10, verse_start: 13, chapter_end: 10, verse_end: 13 }],
  },

  // 7evttd0jJzc/captions.vtt — "psalm 107 43" (space separator)
  {
    snippet: "psalm 107 43 says that we should",
    expected: [
      { book_id: 19, chapter_start: 107, verse_start: 43, chapter_end: 107, verse_end: 43 },
    ],
  },

  // 7evttd0jJzc/captions.vtt — "proverbs 16 verse 9" (keyword form)
  {
    snippet: "proverbs 16 verse 9 says",
    expected: [{ book_id: 20, chapter_start: 16, verse_start: 9, chapter_end: 16, verse_end: 9 }],
  },

  // MhT87ox-Wpg/captions.vtt — required: "john 7 37-38" (space separator + hyphen range)
  {
    snippet: "from jesus in john 7 37-38",
    expected: [{ book_id: 43, chapter_start: 7, verse_start: 37, chapter_end: 7, verse_end: 38 }],
  },

  // Lgq5qgQfg8w/captions.vtt — required: "acts 4 23" (space separator)
  {
    snippet: "uh so in um in acts 4 23 the background",
    expected: [{ book_id: 44, chapter_start: 4, verse_start: 23, chapter_end: 4, verse_end: 23 }],
  },

  // NOAfT6yibfM/captions.vtt — required: "hebrews 12 2" (space separator)
  {
    snippet: "hebrews 12 2 says let us run with",
    expected: [{ book_id: 58, chapter_start: 12, verse_start: 2, chapter_end: 12, verse_end: 2 }],
  },

  // OSCRPGKuVVw/captions.vtt — "jeremiah 33 14-16" (space separator + hyphen range)
  {
    snippet: "our reading is from jeremiah 33 14-16",
    expected: [{ book_id: 24, chapter_start: 33, verse_start: 14, chapter_end: 33, verse_end: 16 }],
  },

  // vBA4INiEDcg/captions.vtt — "hebrews 10 12" (space separator)
  {
    snippet: "relationship hebrews 10 12 says but when",
    expected: [{ book_id: 58, chapter_start: 10, verse_start: 12, chapter_end: 10, verse_end: 12 }],
  },

  // vBA4INiEDcg/captions.vtt — "galatians 1 6" (space separator)
  {
    snippet: "galatians 1 6 he says i am astonished",
    expected: [{ book_id: 48, chapter_start: 1, verse_start: 6, chapter_end: 1, verse_end: 6 }],
  },

  // vBA4INiEDcg/captions.vtt — "hebrews 1 3" (space separator)
  {
    snippet: "sins i think that says in hebrews 1 3",
    expected: [{ book_id: 58, chapter_start: 1, verse_start: 3, chapter_end: 1, verse_end: 3 }],
  },

  // mdIB-fcVKF4/captions.vtt — "psalm 68" chapter-only (ASR sometimes drops verse)
  {
    snippet: "psalms uh psalm 68 where david describes",
    expected: [{ book_id: 19, chapter_start: 68, verse_start: 1, chapter_end: 68, verse_end: -1 }],
  },

  // mdIB-fcVKF4/captions.vtt — "isaiah 58" chapter-only
  {
    snippet: "really repeat to myself is isaiah 58 the",
    expected: [{ book_id: 23, chapter_start: 58, verse_start: 1, chapter_end: 58, verse_end: -1 }],
  },

  // vBA4INiEDcg/captions.vtt — "revelation 3" chapter-only
  {
    snippet: "revelation 3 it says that he behold",
    expected: [{ book_id: 66, chapter_start: 3, verse_start: 1, chapter_end: 3, verse_end: -1 }],
  },
]
