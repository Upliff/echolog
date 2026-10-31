# Echolog: project notes

Read this first in any chat about Echolog. Keep it up to date when something changes.

## What it is

A site where you pick a game, then a song from it. The clip of the moment the song first plays in the game runs, the video shrinks into a mini player, and real comments from people about what that song or game meant to them scroll underneath. When a song ends, the next one starts.

Owner: Mohad. Repo: https://github.com/Upliff/echolog (public).

## Rules for anything written

- **No AI-sounding text.** Mohad will reject it. No "journey", "testament", "resonate", "tapestry", "dive in", "embark", "timeless", no rule-of-three lines, no em dashes, no polished taglines. Keep site text short and plain: labels, buttons, empty states.
- Taglines, about page and anything with personality: leave a placeholder for Mohad to write, or tidy his rough notes without changing his voice.
- Comments are shown exactly as the person wrote them. Never edit or rewrite them.

## Decisions so far

- **Name:** Echolog (echo + log).
- **Sources:** YouTube comments on soundtrack videos. Reddit is out: Reddit stopped taking new API requests on 31 Oct 2026. Steam is off for now: Steam shut its public review endpoint in Oct 2026, and the replacement needs a publisher key. The Steam code stays in `collect.py` behind `STEAM_ENABLED = False`. A "submit your own story" form might come later.
- **No home server, no local AI model.** Everything runs on GitHub: a GitHub Actions job runs nightly, and the site will be hosted on GitHub Pages.
- **Filtering:** a free keyword and score filter (`collector/collect.py`). There's no AI scoring for now; paid AI could be added later if needed. To remove a bad comment, add its id to `data/hidden.txt`.
- **Front end:** plain HTML/CSS/JS in the local `site/` folder for now (see "Front end" below). Reads `data/stories.json`.
- **First game:** Final Fantasy X, with 5 songs (see `config/games.json`).
- **Feel:** snappy and quiet. Only the video and the comments. No heavy effects.
- **Auto next:** when a song ends, the next song in the game starts after a short countdown (wraps to the first song after the last).
- **Music over the scene:** a song can have a separate `audio` track. The scene video plays muted and the music plays over it, so you hear the song without the characters talking.

## Accounts and setup status

- Google Cloud project "Game Stories" (id `leafy-tenure-513307-e2`), with YouTube Data API v3 enabled. The API key is restricted to that API.
- GitHub repo secret `YOUTUBE_API_KEY` is added. Never put the key in code, chat or the site.
- Done: repo created, secret added, Claude GitHub App installed on the repo (Claude can push), and the first runs completed (31 Oct 2026). 196 stories across the 5 FFX songs.
- Done: front end rebuilt for speed (31 Oct 2026), in the local `site/` folder.
- Not done yet: front end moved into the repo.
- Not done yet: GitHub Pages turned on.

## How it works

```
config/games.json        games, songs, clip for each song, videos to pull comments from
collector/collect.py     fetches comments and reviews, filters them, writes data/stories.json
data/stories.json        output the site reads (rebuilt every run)
data/sample-stories.json fake data so the design has something to show
data/hidden.txt          ids of stories to never show
.github/workflows/collect.yml   runs daily ~3am Sydney, or by hand from the Actions tab
```

**Adding a game or song:** edit `config/games.json`.
- `moment` sets the scene that plays: the YouTube `videoId` plus a `start` time in seconds (and `end` if the scene should stop or loop there). Use `null` if there's no clip yet.
- `audio` (optional) is a separate music track: `{ "videoId": "...", "start": 0, "end": null }`. When it's set, the scene plays muted and loops until the music ends. The song ends when the music ends. If there's `audio` but no `moment`, the audio video itself is shown.
- `commentVideos` lists the YouTube videos to pull comments from. Pick videos with lots of views and comments.
- `steamAppId` is the number in the game's Steam store URL. Leave it out if the game isn't on Steam.

**Quota:** YouTube allows 10,000 units a day, and each page of 100 comments costs 1 unit. At 5 pages per video, that's roughly 5 units per video per run, so there's plenty of room.

**Run log:** each run writes a `log` list into `data/stories.json` showing how many comments each video gave, or why it failed. GitHub's own job logs can't be read from Claude's side, so check this instead. A video that gives `403` has comments turned off, so swap it for another.

**YouTube rules:** show the author's name and link back to the comment, and don't keep comment data older than 30 days. The nightly rebuild covers this.

## Data shape (data/stories.json)

```json
{
  "updated": "2026-11-01T05:17:00Z",
  "games": [{
    "id": "ffx", "title": "Final Fantasy X", "year": 2001, "steamAppId": 359870,
    "songs": [{
      "id": "to-zanarkand", "title": "To Zanarkand", "composer": "Nobuo Uematsu",
      "moment": { "videoId": "kilrRiclUFY", "start": 0, "end": null, "label": "Opening, the campfire" },
      "audio": null,
      "stories": [{ "id": "yt:...", "source": "youtube", "author": "@name", "authorUrl": "...",
                    "text": "...", "likes": 5400, "date": "2019-04-01", "url": "...", "videoId": "...", "score": 19.2 }]
    }],
    "stories": [{ "id": "steam:...", "source": "steam", "author": "Steam player", "authorUrl": "...",
                  "text": "...", "likes": 300, "date": "2020-09-13", "url": "...", "hoursPlayed": 100, "score": 12.4 }]
  }]
}
```

Song `stories` come from YouTube. Game-level `stories` are for Steam reviews, which are empty while Steam is off. `audio` is passed straight through from `config/games.json`.

## FFX songs to check

- To Zanarkand and Otherworld: the clips are the opening. Check that they embed and start at the right second.
- Suteki da Ne: the clip is the Macalania scene, a fan upload. The song starts partway in, so `start` needs setting. A good one to try `audio` on.
- Besaid Island and Hymn of the Fayth: no clip chosen yet (`moment: null`). Auto next skips songs with nothing to play.

## Front end

Plain HTML, CSS and JS, no build step. It lives in the local `site/` folder for now (not in the repo yet):

```
site/index.html          page shell: backdrop, top bar, video stage (scene + music players), dock, up-next bar, clouds layer, About dialog
site/assets/style.css    all styles
site/assets/app.js       everything else; all the settings are at the top
site/covers/             one cover image per game (README.txt inside explains naming)
site/data/stories.json   a copy for local preview only; the repo's data/stories.json is the real one
site/preview.bat + .ps1  local preview server for Windows without Python
```

- Routes use the hash: `#/` home, `#/ffx` game, `#/ffx/to-zanarkand` song.
- Look: dark, Cormorant Garamond (titles, comments) and Karla (labels), gold accent `#e8c27a`. The game's cover sits blurred behind every page. No cover image means a plain dark background.
- **Speed rules (keep these):** no `backdrop-filter` and no live CSS blur anywhere. The cover is drawn once into a 24 x 24 canvas and stretched, which blurs it for free; it never moves, it only fades when the game changes. Anything that animates only uses opacity or transform. The video changes size once and the move is animated with transform. Comments off screen aren't drawn (`content-visibility`). Fonts load without holding up the page.
- All comment text goes in through `textContent` (never `innerHTML`), with `white-space: pre-wrap` so line breaks stay.
- "Show more" is decided from the text (over 650 characters or 9 lines), so nothing is measured on screen. Shorter comments are never cut.
- `index.html` loads `style.css?v=5` and `app.js?v=5`. Bump the number after changes so browsers don't use old copies.
- Song page: the clip fills the screen apart from a strip at the bottom with the title, our own controls (play, sound, next song, time, seek bar) and the comment count. YouTube's control bar is hidden (`controls: 0`). Tap the video to pause; tap the small player to make it big again. Space or K also plays/pauses.
- Scrolling: on desktop the video shrinks to a 356 x 200 player in the bottom-right with a small bar under it. On phones the video slides away and a bar sits along the bottom.
- The players stay alive between songs, so the next song loads into the same player and starts quickly.
- **Auto next:** when the song ends, "Next: (song) in 6" appears with "Play now" and "Stay". `AUTO_NEXT_SECONDS` at the top of `app.js` (0 turns it off). Songs with no clip are skipped. After the last song it goes back to the first.
- **Music over the scene:** two players. The scene is on top and always muted; the music player sits under it at 200 x 200 (YouTube's minimum). Play/pause and the seek bar control the music, and the scene follows. If the music video fails, the scene's own sound comes back.
- Clouds: while the big video is playing, short comments (200 characters or less, best 30 by score, shuffled) fade in one at a time in the corners and sides of the video, never the middle. They alternate left and right, stay up for reading time (about 16 characters a second, 6.5 to 14 seconds), drift slightly, then fade out. They stop when the video is paused, small, or the tab is hidden. On phones there's one at a time, just under the video. Settings at the top of `app.js`.
- **Known rule breaks (Mohad's choice):** YouTube's embed rules don't allow anything on top of the player, and don't allow separating a video's audio from its picture or hiding a player. Clouds over the video break the first; the music track under a muted scene breaks the other two. The risk is YouTube suspending the API key the collector uses. Clouds can be moved beside the video with `CLOUDS_OVER_VIDEO = false`. To drop the music overlay, remove `audio` from the songs.
- Missing video: the stage says the clip is unavailable and the next song countdown starts. YouTube script blocked: the stage says so, comments still work.
- If the browser blocks sound, the clip starts muted and the sound button turns gold.
- **Testing without editing data** (add before the `#`, only applies to the song the page opened on):
  - `?t=1:35` scene start, e.g. `http://localhost:8000/?t=1:35#/ffx/suteki-da-ne`
  - `?audio=VIDEOID` music track to lay over the scene, `?at=0:12` music start
  - The real values go in `config/games.json`.
- Local preview: in the `site` folder run `python -m http.server 8000` and open `http://localhost:8000`. `preview.bat` also works. Opening `index.html` straight from disk won't load the data.
- Tested in headless Chromium at 1280x800 and 390x844 with a fake YouTube player. Not tested against real YouTube from Claude's side.

## Known issues (front end)

- The big video shrinking on desktop: fixed in the rebuild. The "calm" shrink only happens when `CLOUDS_OVER_VIDEO` is false.
- The start time backup jump only fires if the player really ignored `start`, so the clip shouldn't jump twice. Worth a check on real YouTube.
- Auto next onto a new song after the page has been idle may start muted if the browser blocks sound. The gold sound button shows when that happens.
- Mini player is 356x200 on desktop because of YouTube's 200x200 minimum.

## Next steps

1. Check the rebuilt site against real YouTube (start times, auto next, sound).
2. Pick `audio` tracks for songs where the scene has talking over the music (Suteki da Ne first), and add them to `config/games.json`.
3. Read through the results. Add bad ones to `hidden.txt`, and tweak `STORY_PHRASES` and `MIN_SCORE` in `collect.py` if needed.
4. Move the front end into the repo root (`index.html`, `assets/`, `covers/`).
5. Turn on GitHub Pages (Settings, then Pages, deploy from the main branch).
