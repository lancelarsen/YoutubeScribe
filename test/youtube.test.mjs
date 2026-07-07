import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compactLines, parseYouTubeUrl, TranscriptError } from '../server/youtube.js'

describe('parseYouTubeUrl', () => {
  const validUrls = [
    ['watch URL', 'https://www.youtube.com/watch?v=aircAruvnKk', 'aircAruvnKk'],
    ['mobile watch URL', 'https://m.youtube.com/watch?v=aircAruvnKk', 'aircAruvnKk'],
    ['music watch URL', 'https://music.youtube.com/watch?v=aircAruvnKk', 'aircAruvnKk'],
    ['short URL', 'https://youtu.be/aircAruvnKk', 'aircAruvnKk'],
    ['embed URL', 'https://www.youtube.com/embed/aircAruvnKk', 'aircAruvnKk'],
    ['shorts URL', 'https://www.youtube.com/shorts/aircAruvnKk', 'aircAruvnKk'],
    ['live URL', 'https://www.youtube.com/live/aircAruvnKk', 'aircAruvnKk'],
  ]

  for (const [name, url, expectedVideoId] of validUrls) {
    it(`returns the video ID for a ${name}`, () => {
      assert.equal(parseYouTubeUrl(url), expectedVideoId)
    })
  }

  const invalidUrls = [
    ['empty input', ''],
    ['non-URL input', 'not a url'],
    ['non-YouTube host', 'https://example.com/watch?v=aircAruvnKk'],
    ['missing watch video ID', 'https://www.youtube.com/watch'],
    ['invalid watch video ID', 'https://www.youtube.com/watch?v=too-short'],
    ['missing embed video ID', 'https://www.youtube.com/embed/'],
    ['unsupported YouTube path', 'https://www.youtube.com/playlist?list=PL123'],
  ]

  for (const [name, url] of invalidUrls) {
    it(`throws invalid_url for ${name}`, () => {
      assert.throws(
        () => parseYouTubeUrl(url),
        (error) => error instanceof TranscriptError && error.code === 'invalid_url',
      )
    })
  }
})

describe('compactLines', () => {
  it('normalizes whitespace and removes blank transcript lines', () => {
    assert.deepEqual(compactLines([' first   line ', '', 'second\nline', '   ']), [
      'first line',
      'second line',
    ])
  })

  it('decodes HTML entities before returning text lines', () => {
    assert.deepEqual(compactLines(['Tom &amp; Jerry', '3 &lt; 4']), ['Tom & Jerry', '3 < 4'])
  })
})
