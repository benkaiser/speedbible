#!/usr/bin/env ruby
# Parse eng-bsb.usfx.xml using the same `bible_parser` gem that bible-api uses,
# and emit per-chapter JSON files matching bible-api.com's response shape.

require 'bundler/setup'
require 'bible_parser'
require 'json'
require 'fileutils'

USFX_PATH    = ARGV[0] || File.expand_path('../../../open-bibles-pr/eng-bsb.usfx.xml', __dir__)
OUT_DIR      = ARGV[1] || File.expand_path('../public/bible-static/bsb', __dir__)

TRANSLATION_ID   = 'bsb'
TRANSLATION_NAME = 'Berean Standard Bible'
TRANSLATION_NOTE = 'Public Domain'

abort "USFX file not found at #{USFX_PATH}" unless File.exist?(USFX_PATH)
FileUtils.mkdir_p(OUT_DIR)

# bible_parser is streaming — collect verses grouped by (book_id, chapter)
chapters = Hash.new { |h, k| h[k] = [] }
book_names = {}

bible = BibleParser.new(File.open(USFX_PATH))
bible.each_verse do |verse|
  data = verse.to_h
  book_id  = data[:book_id]
  book_name = data[:book_title]
  chapter  = data[:chapter_num].to_i
  num      = data[:num].to_i
  text     = data[:text]
  next if text.nil? || text.strip.empty?

  book_names[book_id] = book_name

  chapters[[book_id, chapter]] << {
    'book_id'   => book_id,
    'book_name' => book_name,
    'chapter'   => chapter,
    'verse'     => num,
    'text'      => text
  }
end

# bible-api uses the book NAME (URL-encoded) in the request, e.g. "John+3".
# Build a lookup so the static endpoint matches: /bsb/<book_name_lower>/<chapter>.json
chapters_by_url = Hash.new { |h, k| h[k] = [] }
chapters.each do |(book_id, chapter), verses|
  name = book_names[book_id]
  slug = name.downcase.gsub(/\s+/, '_')
  chapters_by_url[[slug, chapter]] = verses
end

written = 0
chapters_by_url.each do |(slug, chapter), verses|
  verses_sorted = verses.sort_by { |v| v['verse'] }
  book_name = verses_sorted.first['book_name']
  reference = "#{book_name} #{chapter}"
  full_text = verses_sorted.map { |v| v['text'] }.join(' ').gsub(/\s+/, ' ').strip + "\n"

  payload = {
    'reference'        => reference,
    'verses'           => verses_sorted,
    'text'             => full_text,
    'translation_id'   => TRANSLATION_ID,
    'translation_name' => TRANSLATION_NAME,
    'translation_note' => TRANSLATION_NOTE
  }

  dir = File.join(OUT_DIR, slug)
  FileUtils.mkdir_p(dir)
  File.write(File.join(dir, "#{chapter}.json"), JSON.generate(payload))
  written += 1
end

# Manifest of books → chapter counts
manifest = {}
chapters_by_url.keys.each do |(slug, chapter)|
  manifest[slug] ||= { 'name' => chapters_by_url[[slug, chapter]].first['book_name'], 'chapters' => 0 }
  manifest[slug]['chapters'] = [manifest[slug]['chapters'], chapter].max
end
File.write(File.join(OUT_DIR, 'manifest.json'), JSON.pretty_generate(manifest))

puts "Wrote #{written} chapter files + manifest to #{OUT_DIR}"
puts "Books: #{manifest.size}"
