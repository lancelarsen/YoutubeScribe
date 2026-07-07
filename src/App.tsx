import { useLayoutEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  BookOpen,
  Check,
  Clipboard,
  Download,
  Loader2,
  Moon,
  PlayCircle,
  Search,
  Sun,
  TriangleAlert,
} from 'lucide-react'

type TranscriptResponse = {
  text: string
  lines: string[]
  source: 'caption-data' | 'browser-transcript-panel'
  videoId: string
  title?: string
  language?: string
}

type ApiError = {
  error?: {
    code: string
    message: string
  }
}

const examples = [
  'https://www.youtube.com/watch?v=aircAruvnKk',
  'https://youtu.be/dQw4w9WgXcQ',
]

type Theme = 'light' | 'dark'

const themeStorageKey = 'youtube-scribe-theme'

function getInitialTheme(): Theme {
  const storedTheme = window.localStorage.getItem(themeStorageKey)
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Ready for a public YouTube URL.')
  const [result, setResult] = useState<TranscriptResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  const canSubmit = useMemo(() => url.trim().length > 0 && !isLoading, [url, isLoading])
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  async function getTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setIsLoading(true)
    setError(null)
    setCopied(false)
    setResult(null)
    setStatus('Looking for caption data first...')

    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = (await response.json()) as TranscriptResponse | ApiError

      if (isApiError(data)) {
        throw new Error(data.error?.message ?? 'Unable to extract a transcript.')
      }
      if (!response.ok) {
        throw new Error('Unable to extract a transcript.')
      }

      setResult(data)
      setStatus(
        data.source === 'caption-data'
          ? 'Transcript extracted from YouTube caption data.'
          : 'Transcript extracted from the page Transcript panel.',
      )
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Unable to extract a transcript.'
      setError(message)
      setStatus('Transcript request failed.')
    } finally {
      setIsLoading(false)
    }
  }

  async function copyTranscript() {
    if (!result?.text) return
    await navigator.clipboard.writeText(result.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function downloadTranscript() {
    if (!result?.text) return
    const title = result.title?.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || result.videoId
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${title || 'youtube-transcript'}.txt`
    link.click()
    URL.revokeObjectURL(href)
  }

  function useExample(event: ChangeEvent<HTMLSelectElement>) {
    if (event.target.value) setUrl(event.target.value)
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Application header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <PlayCircle size={22} strokeWidth={2.4} />
          </span>
          <div>
            <h1>Transcript Extractor</h1>
            <p>Public YouTube videos only</p>
          </div>
        </div>
        <div className="header-actions">
          <div className={`status-pill ${error ? 'danger' : result ? 'success' : ''}`}>
            {isLoading ? <Loader2 className="spin" size={16} /> : result ? <Check size={16} /> : <Search size={16} />}
            <span>{isLoading ? 'Working' : result ? 'Complete' : error ? 'Needs attention' : 'Idle'}</span>
          </div>
          <a className="icon-button" href="/docs.html" title="Open documentation" aria-label="Open documentation">
            <BookOpen size={18} />
          </a>
          <button
            className="icon-button"
            type="button"
            title={`Switch to ${nextTheme} mode`}
            aria-label={`Switch to ${nextTheme} mode`}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(nextTheme)}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <section className="workspace" aria-label="Transcript extraction workspace">
        <form className="control-panel" onSubmit={getTranscript}>
          <div className="field-row">
            <label htmlFor="youtube-url">YouTube URL</label>
            <div className="input-action">
              <input
                id="youtube-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                autoComplete="off"
              />
              <button type="submit" disabled={!canSubmit}>
                {isLoading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
                <span>Get Transcript</span>
              </button>
            </div>
          </div>

          <div className="secondary-row">
            <select aria-label="Example URLs" defaultValue="" onChange={useExample}>
              <option value="">Load example URL</option>
              {examples.map((example) => (
                <option key={example} value={example}>
                  {example}
                </option>
              ))}
            </select>
            <p className="quiet">Text only. No timestamps. No login or restriction bypass.</p>
          </div>
        </form>

        <section className="output-panel" aria-label="Transcript result">
          <div className="output-toolbar">
            <div>
              <h2>{result?.title || 'Transcript output'}</h2>
              <p>{result ? `${result.lines.length} lines via ${result.source}` : status}</p>
            </div>
            <div className="toolbar-actions">
              <button type="button" onClick={copyTranscript} disabled={!result?.text} title="Copy transcript">
                {copied ? <Check size={18} /> : <Clipboard size={18} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={downloadTranscript}
                disabled={!result?.text}
                title="Download transcript"
              >
                <Download size={18} />
                <span>Download</span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="message error-message" role="alert">
              <TriangleAlert size={20} />
              <span>{error}</span>
            </div>
          ) : null}

          <textarea
            aria-label="Extracted transcript text"
            value={result?.text ?? ''}
            placeholder="The transcript text will appear here."
            readOnly
          />
        </section>
      </section>
    </main>
  )
}

function isApiError(data: TranscriptResponse | ApiError): data is ApiError {
  return 'error' in data
}
