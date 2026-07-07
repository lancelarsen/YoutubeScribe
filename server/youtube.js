import he from 'he'
import { chromium } from 'playwright'

const { decode } = he

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
])

const REQUEST_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
}

export class TranscriptError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'TranscriptError'
    this.code = code
    this.cause = cause
  }
}

export function parseYouTubeUrl(input) {
  let parsed
  try {
    parsed = new URL(input)
  } catch {
    throw new TranscriptError('invalid_url', 'Enter a valid YouTube video URL.')
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, 'www.')
  if (!YOUTUBE_HOSTS.has(hostname)) {
    throw new TranscriptError('invalid_url', 'Enter a valid YouTube video URL.')
  }

  let videoId = null
  if (hostname === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0]
  } else if (parsed.pathname === '/watch') {
    videoId = parsed.searchParams.get('v')
  } else {
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (['embed', 'shorts', 'live'].includes(parts[0])) {
      videoId = parts[1]
    }
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new TranscriptError('invalid_url', 'That URL does not include a valid YouTube video ID.')
  }

  return videoId
}

export async function extractTranscript(inputUrl, options = {}) {
  const videoId = parseYouTubeUrl(inputUrl)
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`

  if (options.forceBrowser) {
    return await extractFromTranscriptPanel(videoId, watchUrl)
  }

  try {
    return await extractFromCaptionData(videoId, watchUrl)
  } catch (captionError) {
    if (captionError instanceof TranscriptError && isTerminalVideoError(captionError.code)) {
      throw captionError
    }

    try {
      return await extractFromTranscriptPanel(videoId, watchUrl)
    } catch (browserError) {
      if (browserError instanceof TranscriptError) throw browserError
      throw new TranscriptError(
        'browser_automation_failed',
        'Browser automation failed while trying to open the Transcript panel.',
        browserError,
      )
    }
  }
}

function isTerminalVideoError(code) {
  return ['invalid_url', 'video_unavailable', 'login_required', 'age_restricted', 'region_restricted'].includes(code)
}

async function extractFromCaptionData(videoId, watchUrl) {
  let response
  try {
    response = await fetch(watchUrl, { headers: REQUEST_HEADERS })
  } catch (error) {
    throw new TranscriptError('network_failure', 'Network failure while loading the YouTube page.', error)
  }

  if (!response.ok) {
    throw new TranscriptError('network_failure', `YouTube returned HTTP ${response.status}.`)
  }

  const html = await response.text()
  const playerResponse = parseInitialPlayerResponse(html)
  const playability = playerResponse?.playabilityStatus
  classifyPlayability(playability)

  const pageTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.filter(Boolean) ?? []
  const apiKey = extractInnertubeApiKey(html)
  const androidTracks = apiKey ? await fetchAndroidCaptionTracks(videoId, apiKey).catch(() => []) : []
  const tracks = androidTracks.length > 0 ? androidTracks : pageTracks

  if (tracks.length === 0) {
    throw new TranscriptError(
      'transcript_unavailable',
      'No caption or transcript data is exposed for this public video.',
    )
  }

  const orderedTracks = orderCaptionTracks(tracks)
  for (const track of orderedTracks) {
    const lines = await fetchCaptionTrackLines(track).catch(() => [])
    if (lines.length > 0) {
      return {
        text: lines.join('\n'),
        lines,
        source: 'caption-data',
        videoId,
        title: playerResponse?.videoDetails?.title,
        language: track.languageCode,
      }
    }
  }

  throw new TranscriptError('transcript_unavailable', 'The caption tracks did not contain transcript text.')
}

function classifyPlayability(playability) {
  const status = playability?.status
  const reason = `${playability?.reason ?? ''} ${playability?.messages?.join(' ') ?? ''}`.toLowerCase()

  if (!status || status === 'OK') return
  if (reason.includes('sign in') || reason.includes('private')) {
    throw new TranscriptError('login_required', 'This video requires login or is private.')
  }
  if (reason.includes('age')) {
    throw new TranscriptError('age_restricted', 'This video appears to be age restricted.')
  }
  if (reason.includes('country') || reason.includes('region') || reason.includes('not available in your')) {
    throw new TranscriptError('region_restricted', 'This video appears to be region restricted.')
  }
  throw new TranscriptError('video_unavailable', playability?.reason || 'This video is unavailable.')
}

function parseInitialPlayerResponse(html) {
  const marker = 'ytInitialPlayerResponse'
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) {
    throw new TranscriptError('video_unavailable', 'Could not read YouTube video metadata.')
  }

  const start = html.indexOf('{', markerIndex)
  if (start === -1) {
    throw new TranscriptError('video_unavailable', 'Could not read YouTube video metadata.')
  }

  const jsonText = readBalancedJsonObject(html, start)
  try {
    return JSON.parse(jsonText)
  } catch (error) {
    throw new TranscriptError('video_unavailable', 'YouTube video metadata could not be parsed.', error)
  }
}

function readBalancedJsonObject(source, start) {
  let depth = 0
  let inString = false
  let isEscaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') inString = true
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new TranscriptError('video_unavailable', 'YouTube video metadata was incomplete.')
}

function extractInnertubeApiKey(html) {
  return html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
}

async function fetchAndroidCaptionTracks(videoId, apiKey) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      ...REQUEST_HEADERS,
      'content-type': 'application/json',
      origin: 'https://www.youtube.com',
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          androidSdkVersion: 35,
          osName: 'Android',
          osVersion: '15',
        },
      },
      videoId,
    }),
  })

  if (!response.ok) return []
  const playerResponse = await response.json()
  classifyPlayability(playerResponse?.playabilityStatus)
  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.filter(Boolean) ?? []
}

function orderCaptionTracks(tracks) {
  const scored = tracks.map((track, index) => {
    let score = index
    if (track.languageCode?.startsWith('en')) score -= 100
    if (track.kind !== 'asr') score -= 20
    return { track, score }
  })

  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.track)
}

async function fetchCaptionTrackLines(track) {
  const captionUrl = new URL(track.baseUrl)
  captionUrl.searchParams.set('fmt', 'json3')

  let response
  try {
    response = await fetch(captionUrl, { headers: REQUEST_HEADERS })
  } catch (error) {
    throw new TranscriptError('network_failure', 'Network failure while loading the caption track.', error)
  }

  if (!response.ok) {
    throw new TranscriptError('network_failure', `YouTube returned HTTP ${response.status} for captions.`)
  }

  const body = await response.text()
  const jsonLines = parseJson3CaptionLines(body)
  if (jsonLines.length > 0) return jsonLines
  return parseXmlCaptionLines(body)
}

function parseJson3CaptionLines(body) {
  try {
    const data = JSON.parse(body)
    return compactLines(
      data.events
        ?.map((event) => event.segs?.map((segment) => segment.utf8 ?? '').join('') ?? '')
        .filter(Boolean) ?? [],
    )
  } catch {
    return []
  }
}

function parseXmlCaptionLines(body) {
  const matches = [...body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
  return compactLines(matches.map((match) => decode(match[1])))
}

export function compactLines(lines) {
  return lines
    .map((line) => decode(String(line)).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

async function extractFromTranscriptPanel(videoId, watchUrl) {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: REQUEST_HEADERS['user-agent'],
      locale: 'en-US',
      viewport: { width: 1366, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await dismissConsent(page)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    await openTranscriptPanel(page)
    const lines = await collectTranscriptLines(page)

    if (lines.length === 0) {
      throw new TranscriptError('transcript_unavailable', 'The Transcript panel did not contain transcript text.')
    }

    const title = await page.title().catch(() => undefined)
    return {
      text: lines.join('\n'),
      lines,
      source: 'browser-transcript-panel',
      videoId,
      title: title?.replace(/ - YouTube$/, ''),
    }
  } finally {
    await browser?.close()
  }
}

async function dismissConsent(page) {
  const labels = [/accept all/i, /reject all/i, /i agree/i]
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first()
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click().catch(() => undefined)
      return
    }
  }
}

async function openTranscriptPanel(page) {
  if (await clickShowTranscript(page)) return

  await expandDescription(page)
  if (await clickShowTranscript(page)) return

  await openOverflowMenu(page)
  if (await clickShowTranscript(page)) return

  throw new TranscriptError('transcript_unavailable', 'YouTube did not expose a Transcript panel for this video.')
}

async function clickShowTranscript(page) {
  const candidates = [
    page.getByRole('button', { name: /show transcript/i }).first(),
    page.getByText(/show transcript/i).first(),
    page.locator('button:has-text("Show transcript")').first(),
    page.locator('tp-yt-paper-button:has-text("Show transcript")').first(),
  ]

  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
      await candidate.click({ timeout: 5000 }).catch(() => undefined)
      await page
        .locator('ytd-transcript-segment-renderer, transcript-segment-view-model, .segment-text')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => undefined)
      return true
    }
  }
  return false
}

async function expandDescription(page) {
  const candidates = [
    page.locator('#description-inline-expander tp-yt-paper-button#expand').first(),
    page.locator('#description button:has-text("more")').first(),
    page.getByRole('button', { name: /^more$/i }).first(),
  ]

  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 1000 }).catch(() => false)) {
      await candidate.click().catch(() => undefined)
      await page.waitForTimeout(600)
      return
    }
  }
}

async function openOverflowMenu(page) {
  const menuButtons = [
    page.locator('ytd-menu-renderer yt-icon-button button[aria-label*="More"]').first(),
    page.locator('button[aria-label="More actions"]').first(),
    page.getByRole('button', { name: /more actions/i }).first(),
  ]

  for (const button of menuButtons) {
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click().catch(() => undefined)
      await page.waitForTimeout(700)
      return
    }
  }
}

async function collectTranscriptLines(page) {
  const panel = page
    .locator(
      '[target-id="engagement-panel-searchable-transcript"], ytd-transcript-segment-list-renderer, #segments-container, ytd-engagement-panel-section-list-renderer',
  )
    .first()
  const found = new Map()
  let stagnantPasses = 0

  for (let pass = 0; pass < 80; pass += 1) {
    const sizeBefore = found.size
    const rows = await readVisibleTranscriptRows(page)

    for (const row of rows) {
      found.set(row.key, row.text)
    }

    const reachedBottom = await scrollTranscriptPanel(page, panel)
    await page.waitForTimeout(250)

    stagnantPasses = found.size === sizeBefore ? stagnantPasses + 1 : 0
    if (reachedBottom && stagnantPasses >= 5) break
  }

  return compactLines([...found.values()])
}

async function readVisibleTranscriptRows(page) {
  const legacyRows = await page.locator('ytd-transcript-segment-renderer').evaluateAll((segments) =>
    segments
      .map((segment) => {
        const text =
          segment.querySelector('.segment-text')?.textContent ??
          segment.querySelector('yt-formatted-string')?.textContent ??
          ''
        const timestamp = segment.querySelector('.segment-timestamp')?.textContent ?? ''
        return { key: `${timestamp}|${text}`, text }
      })
      .filter((row) => row.text.trim().length > 0),
  )

  const modernRows = await page.locator('transcript-segment-view-model').evaluateAll((segments) =>
    segments
      .map((segment) => {
        const candidates = [...segment.querySelectorAll('.ytAttributedStringHost, span')]
          .map((node) => node.textContent?.trim() ?? '')
          .filter(Boolean)
        const text =
          candidates
            .filter((candidate) => !/^\d+:\d+/.test(candidate) && !/^\d+\s+seconds$/i.test(candidate))
            .at(-1) ?? ''
        return { key: segment.textContent?.trim() ?? text, text }
      })
      .filter((row) => row.text.trim().length > 0),
  )

  return [...legacyRows, ...modernRows]
}

async function scrollTranscriptPanel(page, panel) {
  const elementHandle = await panel.elementHandle().catch(() => null)
  if (elementHandle) {
    const reachedBottom = await panel.evaluate((element) => {
      const scrollables = [element, ...element.querySelectorAll('*')].filter((candidate) => {
        const style = window.getComputedStyle(candidate)
        return (
          candidate.scrollHeight > candidate.clientHeight + 2 &&
          ['auto', 'scroll'].includes(style.overflowY)
        )
      })
      const target = scrollables[0] ?? element
      const previous = target.scrollTop
      target.scrollTop = Math.min(target.scrollTop + target.clientHeight * 0.85, target.scrollHeight)
      return Math.abs(target.scrollTop - previous) < 2
    })
    if (!reachedBottom) return false
  }

  const box = await panel.boundingBox().catch(() => null)
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 500))
    await page.mouse.wheel(0, Math.max(500, box.height * 0.8))
  }

  return true
}
