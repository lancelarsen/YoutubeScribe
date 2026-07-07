import { extractTranscript } from '../server/youtube.js'

const forceBrowser = process.argv.includes('--browser')
const url = process.argv.find((argument) => argument.startsWith('http')) || 'https://www.youtube.com/watch?v=aircAruvnKk'

try {
  const transcript = await extractTranscript(url, { forceBrowser })
  if (!transcript.text || transcript.lines.length === 0) {
    throw new Error('Transcript result was empty.')
  }

  console.log(`Verified: ${transcript.lines.length} text lines`)
  console.log(`Source: ${transcript.source}`)
  console.log(`Video: ${transcript.title || transcript.videoId}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
