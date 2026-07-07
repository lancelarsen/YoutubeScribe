# YouTube Transcript Extractor

Updated: 2026-07-07

Local app that accepts a public YouTube video URL and returns transcript text only.

## Run

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The app serves the React UI and API from the same local Express server. In production mode,
build first and then start the server:

```powershell
npm run build
$env:NODE_ENV = "production"
npm start
```

## Verify

```powershell
npm run verify
```

You can also pass a public YouTube URL:

```powershell
npm run verify -- "https://www.youtube.com/watch?v=aircAruvnKk"
```

To verify the browser Transcript-panel fallback:

```powershell
node scripts/verify.mjs --browser "https://www.youtube.com/watch?v=UF8uR6Z6KLc"
```

## User Workflow

1. Paste a public YouTube URL, or choose one of the example URLs.
2. Select **Get Transcript**.
3. Copy the transcript to the clipboard or download it as a `.txt` file.
4. Use the documentation icon in the upper-right corner of the app for a user-facing guide.
5. Use the theme icon in the upper-right corner to switch between light and dark mode.

The output is transcript text only. The app intentionally removes timestamps.

## Supported YouTube URLs

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`

The video ID must be an 11-character YouTube ID.

## Extraction Behavior

- First tries YouTube caption/transcript data from the public watch page.
- Prefers English caption tracks when available.
- Falls back to Playwright browser automation that opens the video page and reads the Transcript panel.
- Returns transcript text only, with no timestamps.
- Does not bypass login, age gates, private videos, paywalls, or region restrictions.

## API

`POST /api/transcript`

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=aircAruvnKk"
}
```

Success response:

```json
{
  "text": "Transcript text...",
  "lines": ["Transcript text..."],
  "source": "caption-data",
  "videoId": "aircAruvnKk",
  "title": "Video title",
  "language": "en"
}
```

`source` is either `caption-data` or `browser-transcript-panel`.

Error response:

```json
{
  "error": {
    "code": "transcript_unavailable",
    "message": "No caption or transcript data is exposed for this public video."
  }
}
```

Known error codes include:

- `invalid_url`
- `video_unavailable`
- `login_required`
- `age_restricted`
- `region_restricted`
- `transcript_unavailable`
- `network_failure`
- `browser_automation_failed`
- `unknown_error`

## Developer Notes

- Frontend entry point: `src/App.tsx`
- Shared styling: `src/style.css`
- Express server and API route: `server/index.js`
- Transcript extraction logic: `server/youtube.js`
- Verification script: `scripts/verify.mjs`
- Static user documentation exposed by the app: `public/docs.html`

The browser fallback depends on Playwright and a Chromium browser install from the local
Node environment. If fallback verification fails because the browser is missing, install
Playwright browsers with:

```powershell
npx playwright install chromium
```
