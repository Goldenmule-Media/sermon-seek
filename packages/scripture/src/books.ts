export interface Book {
  id: number
  canonical_name: string
  abbreviations: string[]
  chapter_count: number
  max_verse: number[]
}

export const BOOKS: Book[] = [
  {
    id: 1,
    canonical_name: "Genesis",
    abbreviations: ["Gen", "Ge", "Gn"],
    chapter_count: 50,
    max_verse: [
      31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20,
      67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34,
      31, 22, 33, 26,
    ],
  },
  {
    id: 2,
    canonical_name: "Exodus",
    abbreviations: ["Exod", "Ex", "Exo"],
    chapter_count: 40,
    max_verse: [
      22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33,
      18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38,
    ],
  },
  {
    id: 3,
    canonical_name: "Leviticus",
    abbreviations: ["Lev", "Le", "Lv"],
    chapter_count: 27,
    max_verse: [
      17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 24, 33, 3, 49, 12, 44,
      23, 27, 25,
    ],
  },
  {
    id: 4,
    canonical_name: "Numbers",
    abbreviations: ["Num", "Nu", "Nm", "Nb"],
    chapter_count: 36,
    max_verse: [
      54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30,
      25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13,
    ],
  },
  {
    id: 5,
    canonical_name: "Deuteronomy",
    abbreviations: ["Deut", "Dt", "De"],
    chapter_count: 34,
    max_verse: [
      46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25,
      22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12,
    ],
  },
  {
    id: 6,
    canonical_name: "Joshua",
    abbreviations: ["Josh", "Jos", "Jsh"],
    chapter_count: 24,
    max_verse: [
      18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33,
    ],
  },
  {
    id: 7,
    canonical_name: "Judges",
    abbreviations: ["Judg", "Jdg", "Jg", "Jgs"],
    chapter_count: 21,
    max_verse: [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  },
  {
    id: 8,
    canonical_name: "Ruth",
    abbreviations: ["Ruth", "Rth", "Ru"],
    chapter_count: 4,
    max_verse: [22, 23, 18, 22],
  },
  {
    id: 9,
    canonical_name: "1 Samuel",
    abbreviations: ["1 Sam", "1Sam", "1 Sa", "1Sa", "1 Sm", "1Sm", "First Samuel"],
    chapter_count: 31,
    max_verse: [
      28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29,
      22, 44, 25, 12, 25, 11, 31, 13,
    ],
  },
  {
    id: 10,
    canonical_name: "2 Samuel",
    abbreviations: ["2 Sam", "2Sam", "2 Sa", "2Sa", "2 Sm", "2Sm", "Second Samuel"],
    chapter_count: 24,
    max_verse: [
      27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39,
      25,
    ],
  },
  {
    id: 11,
    canonical_name: "1 Kings",
    abbreviations: ["1 Kgs", "1Kgs", "1 Ki", "1Ki", "1 Kg", "1Kg", "First Kings"],
    chapter_count: 22,
    max_verse: [
      53, 70, 60, 34, 50, 38, 52, 48, 44, 54, 64, 55, 46, 34, 54, 48, 37, 56, 53, 27, 53, 54,
    ],
  },
  {
    id: 12,
    canonical_name: "2 Kings",
    abbreviations: ["2 Kgs", "2Kgs", "2 Ki", "2Ki", "2 Kg", "2Kg", "Second Kings"],
    chapter_count: 25,
    max_verse: [
      18, 37, 53, 58, 26, 35, 40, 43, 23, 34, 23, 45, 27, 25, 35, 23, 38, 34, 29, 41, 38, 25, 35,
      20, 20,
    ],
  },
  {
    id: 13,
    canonical_name: "1 Chronicles",
    abbreviations: ["1 Chr", "1Chr", "1 Ch", "1Ch", "First Chronicles"],
    chapter_count: 29,
    max_verse: [
      54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31,
      31, 32, 34, 21, 30,
    ],
  },
  {
    id: 14,
    canonical_name: "2 Chronicles",
    abbreviations: ["2 Chr", "2Chr", "2 Ch", "2Ch", "Second Chronicles"],
    chapter_count: 36,
    max_verse: [
      17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21,
      27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23,
    ],
  },
  {
    id: 15,
    canonical_name: "Ezra",
    abbreviations: ["Ezra", "Ezr"],
    chapter_count: 10,
    max_verse: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  },
  {
    id: 16,
    canonical_name: "Nehemiah",
    abbreviations: ["Neh", "Ne"],
    chapter_count: 13,
    max_verse: [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  },
  {
    id: 17,
    canonical_name: "Esther",
    abbreviations: ["Esth", "Est", "Es"],
    chapter_count: 10,
    max_verse: [22, 28, 23, 31, 33, 30, 17, 15, 20, 19],
  },
  {
    id: 18,
    canonical_name: "Job",
    abbreviations: ["Job", "Jb"],
    chapter_count: 42,
    max_verse: [
      22, 17, 16, 21, 17, 10, 20, 12, 19, 13, 14, 17, 18, 33, 21, 16, 15, 18, 33, 21, 11, 17, 12,
      10, 11, 30, 16, 33, 7, 40, 22, 13, 14, 20, 28, 17, 10, 19, 42, 20, 12, 11,
    ],
  },
  {
    id: 19,
    canonical_name: "Psalm",
    abbreviations: ["Ps", "Psa", "Pss", "Psalms"],
    chapter_count: 150,
    max_verse: [
      6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12,
      14, 9, 11, 13, 25, 11, 22, 23, 28, 13, 40, 23, 14, 18, 14, 12, 5, 27, 18, 12, 10, 15, 21, 23,
      21, 11, 7, 9, 24, 14, 12, 12, 18, 14, 9, 13, 12, 11, 14, 20, 8, 36, 37, 6, 24, 20, 28, 23, 11,
      13, 21, 72, 13, 20, 17, 8, 19, 13, 14, 17, 7, 19, 53, 17, 16, 16, 5, 23, 11, 13, 12, 9, 9, 5,
      8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6,
      5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 14, 10, 8, 12, 15, 21, 10, 20, 14, 9, 6,
    ],
  },
  {
    id: 20,
    canonical_name: "Proverbs",
    abbreviations: ["Prov", "Pro", "Pr", "Prv"],
    chapter_count: 31,
    max_verse: [
      33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35,
      34, 28, 28, 27, 28, 62, 35, 22,
    ],
  },
  {
    id: 21,
    canonical_name: "Ecclesiastes",
    abbreviations: ["Eccl", "Ecc", "Ec", "Qoh"],
    chapter_count: 12,
    max_verse: [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  },
  {
    id: 22,
    canonical_name: "Song of Solomon",
    abbreviations: ["Song", "SOS", "SS", "Sg", "Song of Songs", "Canticles"],
    chapter_count: 8,
    max_verse: [17, 17, 11, 16, 16, 13, 13, 14],
  },
  {
    id: 23,
    canonical_name: "Isaiah",
    abbreviations: ["Isa", "Is"],
    chapter_count: 66,
    max_verse: [
      31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12,
      21, 13, 29, 24, 33, 9, 20, 24, 21, 29, 2, 26, 16, 2, 25, 29, 9, 47, 34, 12, 14, 2, 15, 30, 14,
      44, 23, 45, 9, 42, 28, 4, 24, 22, 13, 25, 16, 25, 22, 34, 10,
    ],
  },
  {
    id: 24,
    canonical_name: "Jeremiah",
    abbreviations: ["Jer", "Je", "Jr"],
    chapter_count: 52,
    max_verse: [
      19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40,
      10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7,
      47, 39, 46, 64, 34,
    ],
  },
  {
    id: 25,
    canonical_name: "Lamentations",
    abbreviations: ["Lam", "La"],
    chapter_count: 5,
    max_verse: [22, 22, 66, 22, 22],
  },
  {
    id: 26,
    canonical_name: "Ezekiel",
    abbreviations: ["Ezek", "Eze", "Ezk"],
    chapter_count: 48,
    max_verse: [
      28, 10, 27, 21, 17, 17, 14, 20, 28, 22, 35, 46, 33, 33, 31, 22, 26, 20, 27, 25, 26, 31, 23,
      30, 21, 13, 25, 14, 27, 23, 15, 14, 24, 16, 31, 14, 25, 14, 25, 20, 27, 25, 24, 18, 22, 16,
      27, 20,
    ],
  },
  {
    id: 27,
    canonical_name: "Daniel",
    abbreviations: ["Dan", "Da", "Dn"],
    chapter_count: 12,
    max_verse: [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
  },
  {
    id: 28,
    canonical_name: "Hosea",
    abbreviations: ["Hos", "Ho"],
    chapter_count: 14,
    max_verse: [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  },
  {
    id: 29,
    canonical_name: "Joel",
    abbreviations: ["Joel", "Jl"],
    chapter_count: 3,
    max_verse: [20, 32, 21],
  },
  {
    id: 30,
    canonical_name: "Amos",
    abbreviations: ["Amos", "Am"],
    chapter_count: 9,
    max_verse: [15, 16, 15, 13, 27, 14, 17, 14, 15],
  },
  {
    id: 31,
    canonical_name: "Obadiah",
    abbreviations: ["Obad", "Ob"],
    chapter_count: 1,
    max_verse: [21],
  },
  {
    id: 32,
    canonical_name: "Jonah",
    abbreviations: ["Jonah", "Jon", "Jnh"],
    chapter_count: 4,
    max_verse: [17, 10, 10, 11],
  },
  {
    id: 33,
    canonical_name: "Micah",
    abbreviations: ["Mic", "Mc"],
    chapter_count: 7,
    max_verse: [16, 13, 12, 13, 15, 16, 20],
  },
  {
    id: 34,
    canonical_name: "Nahum",
    abbreviations: ["Nah", "Na"],
    chapter_count: 3,
    max_verse: [15, 13, 19],
  },
  {
    id: 35,
    canonical_name: "Habakkuk",
    abbreviations: ["Hab"],
    chapter_count: 3,
    max_verse: [17, 20, 19],
  },
  {
    id: 36,
    canonical_name: "Zephaniah",
    abbreviations: ["Zeph", "Zep", "Zp"],
    chapter_count: 3,
    max_verse: [18, 15, 20],
  },
  {
    id: 37,
    canonical_name: "Haggai",
    abbreviations: ["Hag", "Hg"],
    chapter_count: 2,
    max_verse: [15, 23],
  },
  {
    id: 38,
    canonical_name: "Zechariah",
    abbreviations: ["Zech", "Zec", "Zc"],
    chapter_count: 14,
    max_verse: [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  },
  {
    id: 39,
    canonical_name: "Malachi",
    abbreviations: ["Mal", "Ml"],
    chapter_count: 4,
    max_verse: [14, 17, 18, 6],
  },
  {
    id: 40,
    canonical_name: "Matthew",
    abbreviations: ["Matt", "Mt", "Mat"],
    chapter_count: 28,
    max_verse: [
      25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39,
      51, 46, 75, 66, 20,
    ],
  },
  {
    id: 41,
    canonical_name: "Mark",
    abbreviations: ["Mark", "Mk", "Mr"],
    chapter_count: 16,
    max_verse: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  },
  {
    id: 42,
    canonical_name: "Luke",
    abbreviations: ["Luke", "Lk", "Lu"],
    chapter_count: 24,
    max_verse: [
      80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56,
      53,
    ],
  },
  {
    id: 43,
    canonical_name: "John",
    abbreviations: ["Jn", "Joh"],
    chapter_count: 21,
    max_verse: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  },
  {
    id: 44,
    canonical_name: "Acts",
    abbreviations: ["Acts", "Ac"],
    chapter_count: 28,
    max_verse: [
      26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35,
      27, 27, 32, 44, 31,
    ],
  },
  {
    id: 45,
    canonical_name: "Romans",
    abbreviations: ["Rom", "Ro", "Rm"],
    chapter_count: 16,
    max_verse: [32, 29, 31, 25, 21, 23, 25, 39, 21, 36, 21, 17, 26, 18, 26, 33],
  },
  {
    id: 46,
    canonical_name: "1 Corinthians",
    abbreviations: ["1 Cor", "1Cor", "1 Co", "1Co", "First Corinthians", "1 Corinthians"],
    chapter_count: 16,
    max_verse: [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  },
  {
    id: 47,
    canonical_name: "2 Corinthians",
    abbreviations: ["2 Cor", "2Cor", "2 Co", "2Co", "Second Corinthians", "2 Corinthians"],
    chapter_count: 13,
    max_verse: [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  },
  {
    id: 48,
    canonical_name: "Galatians",
    abbreviations: ["Gal", "Ga"],
    chapter_count: 6,
    max_verse: [24, 21, 29, 31, 26, 18],
  },
  {
    id: 49,
    canonical_name: "Ephesians",
    abbreviations: ["Eph", "Ephes"],
    chapter_count: 6,
    max_verse: [23, 22, 21, 32, 33, 24],
  },
  {
    id: 50,
    canonical_name: "Philippians",
    abbreviations: ["Phil", "Php", "Phlp"],
    chapter_count: 4,
    max_verse: [30, 30, 21, 23],
  },
  {
    id: 51,
    canonical_name: "Colossians",
    abbreviations: ["Col"],
    chapter_count: 4,
    max_verse: [29, 23, 25, 18],
  },
  {
    id: 52,
    canonical_name: "1 Thessalonians",
    abbreviations: ["1 Thess", "1Thess", "1 Thes", "1Thes", "1 Th", "1Th", "First Thessalonians"],
    chapter_count: 5,
    max_verse: [10, 20, 13, 18, 28],
  },
  {
    id: 53,
    canonical_name: "2 Thessalonians",
    abbreviations: ["2 Thess", "2Thess", "2 Thes", "2Thes", "2 Th", "2Th", "Second Thessalonians"],
    chapter_count: 3,
    max_verse: [12, 17, 18],
  },
  {
    id: 54,
    canonical_name: "1 Timothy",
    abbreviations: ["1 Tim", "1Tim", "1 Ti", "1Ti", "First Timothy"],
    chapter_count: 6,
    max_verse: [20, 15, 16, 16, 25, 21],
  },
  {
    id: 55,
    canonical_name: "2 Timothy",
    abbreviations: ["2 Tim", "2Tim", "2 Ti", "2Ti", "Second Timothy"],
    chapter_count: 4,
    max_verse: [18, 26, 17, 22],
  },
  {
    id: 56,
    canonical_name: "Titus",
    abbreviations: ["Titus", "Tit"],
    chapter_count: 3,
    max_verse: [16, 15, 15],
  },
  {
    id: 57,
    canonical_name: "Philemon",
    abbreviations: ["Phlm", "Phm", "Philem"],
    chapter_count: 1,
    max_verse: [25],
  },
  {
    id: 58,
    canonical_name: "Hebrews",
    abbreviations: ["Heb"],
    chapter_count: 13,
    max_verse: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  },
  {
    id: 59,
    canonical_name: "James",
    abbreviations: ["Jas"],
    chapter_count: 5,
    max_verse: [27, 26, 18, 17, 20],
  },
  {
    id: 60,
    canonical_name: "1 Peter",
    abbreviations: ["1 Pet", "1Pet", "1 Pe", "1Pe", "1 Pt", "1Pt", "First Peter"],
    chapter_count: 5,
    max_verse: [25, 25, 22, 17, 19],
  },
  {
    id: 61,
    canonical_name: "2 Peter",
    abbreviations: ["2 Pet", "2Pet", "2 Pe", "2Pe", "2 Pt", "2Pt", "Second Peter"],
    chapter_count: 3,
    max_verse: [21, 22, 18],
  },
  {
    id: 62,
    canonical_name: "1 John",
    abbreviations: ["1 Jn", "1Jn", "1 Joh", "1Joh", "First John"],
    chapter_count: 5,
    max_verse: [10, 29, 24, 21, 21],
  },
  {
    id: 63,
    canonical_name: "2 John",
    abbreviations: ["2 Jn", "2Jn", "2 Joh", "2Joh", "Second John"],
    chapter_count: 1,
    max_verse: [13],
  },
  {
    id: 64,
    canonical_name: "3 John",
    abbreviations: ["3 Jn", "3Jn", "3 Joh", "3Joh", "Third John"],
    chapter_count: 1,
    max_verse: [15],
  },
  {
    id: 65,
    canonical_name: "Jude",
    abbreviations: ["Jud"],
    chapter_count: 1,
    max_verse: [25],
  },
  {
    id: 66,
    canonical_name: "Revelation",
    abbreviations: ["Rev", "Re", "Rv"],
    chapter_count: 22,
    max_verse: [
      20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21,
    ],
  },
]

export const BOOKS_BY_ID: Record<number, Book> = Object.fromEntries(BOOKS.map((b) => [b.id, b]))

function buildLookup(): Map<string, number> {
  const map = new Map<string, number>()

  const addKey = (raw: string, id: number) => {
    const key = raw.toLowerCase().replace(/\s+/g, " ").trim()
    if (map.has(key) && map.get(key) !== id) {
      throw new Error(`BOOK_LOOKUP collision: "${key}" maps to both ${map.get(key)} and ${id}`)
    }
    map.set(key, id)
  }

  for (const book of BOOKS) {
    addKey(book.canonical_name, book.id)
    for (const abbr of book.abbreviations) {
      addKey(abbr, book.id)
      // Expand ordinal prefix: "1 Foo" → also add "first foo", "2 Foo" → "second foo", etc.
      const ordinalMap: Record<string, string> = {
        "1 ": "first ",
        "2 ": "second ",
        "3 ": "third ",
      }
      for (const [digit, word] of Object.entries(ordinalMap)) {
        const lowerAbbr = abbr.toLowerCase()
        if (lowerAbbr.startsWith(digit)) {
          addKey(word + lowerAbbr.slice(2), book.id)
        }
      }
    }
    // Also add word-prefix variants for the canonical name
    const lowerCanon = book.canonical_name.toLowerCase()
    const ordinalMap: Record<string, string> = {
      "1 ": "first ",
      "2 ": "second ",
      "3 ": "third ",
    }
    for (const [digit, word] of Object.entries(ordinalMap)) {
      if (lowerCanon.startsWith(digit)) {
        addKey(word + lowerCanon.slice(2), book.id)
      }
    }
  }

  return map
}

export const BOOK_LOOKUP: Map<string, number> = buildLookup()
