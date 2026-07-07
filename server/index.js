import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { extractTranscript, TranscriptError } from './youtube.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 5173)

const app = express()
app.use(express.json({ limit: '32kb' }))

app.post('/api/transcript', async (request, response) => {
  const url = typeof request.body?.url === 'string' ? request.body.url : ''

  try {
    const transcript = await extractTranscript(url)
    response.json(transcript)
  } catch (error) {
    const transcriptError =
      error instanceof TranscriptError
        ? error
        : new TranscriptError('unknown_error', 'Unable to extract a transcript.', error)

    const status = statusForError(transcriptError.code)
    response.status(status).json({
      error: {
        code: transcriptError.code,
        message: transcriptError.message,
      },
    })
  }
})

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')))
  app.get('*', (_request, response) => {
    response.sendFile(path.join(root, 'dist', 'index.html'))
  })
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Transcript Extractor running at http://127.0.0.1:${port}`)
})

function statusForError(code) {
  if (code === 'invalid_url') return 400
  if (['video_unavailable', 'login_required', 'age_restricted', 'region_restricted'].includes(code)) {
    return 403
  }
  if (code === 'transcript_unavailable') return 404
  if (code === 'network_failure') return 502
  if (code === 'browser_automation_failed') return 500
  return 500
}
