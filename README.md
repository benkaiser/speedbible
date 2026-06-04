# SpeedBible

A Spritz-style speed reader for the Bible. Read at 300–1000+ WPM using **Rapid Serial Visual Presentation (RSVP)** — words flash one at a time with the optimal recognition point fixed in place, so your eyes stay still and you skip the saccades that slow normal reading.

🌐 **Live**: https://benkaiser.github.io/speedbible/

## What's RSVP?

Normal reading is bottlenecked by eye movement (~200ms per saccade). RSVP shows one word at a time at a fixed point, with the **Optimal Recognition Point** (the letter your eye naturally fixates on) red and column-locked. Trained readers can hit 600–1000 WPM with comprehension comparable to traditional reading.

## Features

- 📖 **Berean Standard Bible** bundled offline as static assets — works without any third-party API
- 🔤 Six other translations (KJV, ASV, WEB, BBE, OEB-CW, OEB-US) via [bible-api.com](https://bible-api.com)
- 🎯 Column-locked ORP highlighting in red (Spritz-style)
- 🎚️ Adjustable WPM slider (100–1500)
- 🎬 Seek bar with verse tooltip and time-remaining estimate
- 📑 Reader View — click any verse to jump to it in RSVP mode
- 🔍 Searchable book picker (type a book name or filter live)
- ☀️ / 🌙 Light and dark themes (respects `prefers-color-scheme`)
- ⏯️ Resumes where you left off (localStorage)

## Audio mode (synced narration)

For BSB chapters, SpeedBible can sync RSVP word-flashing with the public-domain
[Hays narration](https://github.com/benkaiser/bsb-plan-generator) using forced alignment.
When audio is enabled, the `<audio>` element drives the word index via
`audio.currentTime`, and `audio.playbackRate` is set to `wpm / natural_wpm` so the
narrator speeds up to match your RSVP rate.

Browsers preserve pitch up to ~3-4× (≈ 600 WPM); above that the audio gets choppy
and you may want to turn it off. There's no soft cap — your call.

### Generating alignment data

```sh
cd scripts
python3.12 -m venv align-venv
source align-venv/bin/activate
pip install whisperx

# One chapter:
python batch_align.py john:3

# All 1189 chapters (takes hours on CPU, much faster on GPU):
python batch_align.py --all
```

Outputs land in `app/public/bible-static/bsb-align/<book-slug>/<chapter>.json`,
each ≈ 25-40 KB. Audio MP3s themselves are streamed at runtime from
`bsb-plan-generator/audio_processed/`, not bundled in this repo.

The aligner uses [WhisperX](https://github.com/m-bain/whisperX)'s wav2vec2 forced
alignment. Each chapter's audio starts with a `"<Book> <chapter>"` preamble, which
the script prepends to the alignment text and then trims from the output, recording
the preamble end time so the player can skip past it.

## Stack

- React 19 + TypeScript + Vite
- Static-first: deploys to GitHub Pages
- BSB chapters pre-parsed from [eBible.org's USFX](https://ebible.org/find/details.php?id=engbsb) using the same [`bible_parser`](https://github.com/seven1m/bible_parser) gem [bible-api.com](https://github.com/seven1m/bible_api) uses, so the response shape is byte-compatible.

## Local development

```sh
cd app
npm install
npm run dev
```

## Regenerating BSB static assets

```sh
cd scripts
bundle install
bundle exec ruby build_bsb_static.rb path/to/eng-bsb.usfx.xml
```

This writes 1189 chapter JSON files into `app/public/bible-static/bsb/<book-slug>/<chapter>.json`, each matching the bible-api.com response shape exactly.

## Translations

| ID       | Translation                              | Source                |
|----------|------------------------------------------|-----------------------|
| `bsb`    | Berean Standard Bible                    | Static (this repo)    |
| `kjv`    | King James Version                       | bible-api.com         |
| `asv`    | American Standard Version (1901)         | bible-api.com         |
| `web`    | World English Bible                      | bible-api.com         |
| `bbe`    | Bible in Basic English                   | bible-api.com         |
| `oeb-cw` | Open English Bible, Commonwealth         | bible-api.com         |
| `oeb-us` | Open English Bible, US                   | bible-api.com         |

The Berean Standard Bible is in the public domain. SpeedBible is not affiliated with the BSB project or bible-api.com.

## Credits

- Inspired by [rsvpbible.com](https://rsvpbible.com) by AXIA Enterprises
- Spritz / RSVP technique: [spritzinc.com](https://spritzinc.com)
- BSB text: [bereanbible.com](https://bereanbible.com)
- Public-domain translations: [bible-api.com](https://bible-api.com) by Tim Morgan
