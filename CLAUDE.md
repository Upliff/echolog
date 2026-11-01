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
- **Sources:** YouTube comments on soundtrack videos. Reddit is out: Reddit stopped taking new API requests on 31 Oct 2026. Steam is off for now: Steam shut its public review endpoint in Oct 2026, and the replacement needs a publisher key. The Steam code stays in `collect.py` behind `STEAM_ENABLED = False`. People can also send their own comments (see below).
- **No home server, no local AI model.** Everything runs on GitHub: a GitHub Actions job runs nightly, and the site will be hosted on GitHub Pages.
- **Filtering:** a free keyword and score filter (`collector/collect.py`). There's no AI scoring for now; paid AI could be added later if needed. To remove a bad comment, add its id to `data/hidden.txt`.
- **Front end:** plain HTML/CSS/JS at the repo root (see "Front end" below). Reads `data/stories.json`.
- **First game:** Final Fantasy X, with 5 songs (see `config/games.json`).
- **Feel:** snappy and quiet. Only the video and the comments. No heavy effects.
- **Auto next:** "Next: (song)" shows a few seconds before a song ends and the next song starts straight after (wraps to the first song after the last). A repeat button plays the same song again instead.
- **Music over the scene:** a song can have a separate `audio` track. The scene video plays muted and the music plays over it, so you hear the song without the characters talking.
- **People's own comments:** visitors can add their own comment to a song. Nothing goes up until Mohad approves it in the admin page. Approved ones show exactly as written. (Planned, see "Own comments, requests and hiding names".)
- **Requests:** visitors can request a game, a song or a fix. Mohad sees them in the admin page and can accept one, which opens the game/song editor filled in. (Planned.)
- **Hide names:** a switch on the site that hides commenters' names. (Planned.)
- **Several scenes per song:** when a song plays more than once in a game, it can have several scenes and people can swap between them. (Built, see "More than one scene per song".)
- **Sounds:** a gold Sounds button at the right end of the strip under the video opens a panel of short game sounds, which play over the music. Each game has one bank of sounds (each file uploaded once), and each song picks which of them it shows (e.g. battle sounds only on battle themes). Decided 1 Nov 2026. Mohad uploads and picks them in the admin page. The files are game audio, so hosting them publicly carries the same copyright risk as the clips (Mohad's choice).
- **Inbox:** comments and requests go to a private GitHub repo as issues, through a free Cloudflare Worker. Decided 31 Oct 2026 over a Google Form.

## Accounts and setup status

- Google Cloud project "Game Stories" (id `leafy-tenure-513307-e2`), with YouTube Data API v3 enabled. The API key is restricted to that API.
- GitHub repo secret `YOUTUBE_API_KEY` is added. Never put the key in code, chat or the site.
- Done: repo created, secret added, Claude GitHub App installed on the repo (Claude can push), and the first runs completed (31 Oct 2026). 196 stories across the 5 FFX songs.
- Done: front end rebuilt for speed and moved into the repo root (31 Oct 2026). The `site/` folder in the local EchoLog folder is now an old copy. Edit the repo, not that folder.
- Not done yet: GitHub Pages turned on.
- Not done yet: private repo `Upliff/echolog-inbox`, Cloudflare account and Worker, Turnstile site key (all for own comments and requests).

## How it works

```
config/games.json        games, songs, clip for each song, videos to pull comments from
collector/collect.py     fetches comments and reviews, filters them, writes data/stories.json
data/stories.json        output the site reads (rebuilt every run)
data/sample-stories.json fake data so the design has something to show
data/hidden.txt          ids of stories to never show
.github/workflows/collect.yml   runs daily ~3am Sydney, or by hand from the Actions tab
```

**Adding a game or song:** use the admin page (below), an import file (`docs/IMPORT.md`, for adding lots at once; a Claude chat can make one), or edit `config/games.json` by hand.
- `moment` sets the scene that plays: the YouTube `videoId` plus a `start` time in seconds (and `end` if the scene should stop or loop there). Use `null` if there's no clip yet.
- `audio` (optional) is a separate music track: `{ "videoId": "...", "start": 0, "end": null }`. When it's set, the scene plays muted and loops until the music ends. The song ends when the music ends. If there's `audio` but no `moment`, the audio video itself is shown.
- `commentVideos` lists the YouTube videos to pull comments from. Pick videos with lots of views and comments. A scene in `moments` can have its own `commentVideos`; then that scene shows its own comments, and scenes without any show the song's.
- Start and end times can have milliseconds (decimal seconds, e.g. `83.456`).
- `steamAppId` is the number in the game's Steam store URL. Leave it out if the game isn't on Steam.

**Admin page:** `echolog-admin.html` in the local EchoLog folder (deliberately not in the repo or on the site). Mohad opens it straight from disk in his browser.
- **Only one chat edits the admin page: the admin chat** (Mohad's chat for the admin page, which also built the collector). Every other chat must not write `echolog-admin.html`, not even a small fix. If another chat's work needs something in the admin page (a new field, a new setting), it adds a line to "Admin page requests" below and tells Mohad to take it to the admin chat.
- The admin chat reads the current file from the EchoLog folder before every edit, and never writes back an older copy.
- **Writing files to the EchoLog folder from a cloud chat:** `device_commit_files` can send an old cached copy when the same staged file name (e.g. `/mnt/user-data/outputs/echolog-admin.html`) is reused, which overwrote the admin page and ECHOLOG.md with older versions several times on 31 Oct and 1 Nov 2026 (first blamed on another chat). Always copy to a new, unique staged name (e.g. `echolog-admin-<timestamp>.html`) before committing, then stage the folder file back and compare it to make sure the new version landed.
- Lists games. You can add, edit or delete a game: name, year, cover art, and songs (name, composer, scenes, optional music track, comment videos). It can also reorder songs.
- **Scenes:** each song has a list of scenes (link, start, end, label), which you can add, remove and reorder. Each scene can have its own music under "Different music for this scene". It saves `moments` and also writes `moment` as a copy of the first scene, so the site works before it supports `moments`.
- **Music track:** a link, a start and an **end**. The end cuts off dead air at the end of a song (added 31 Oct 2026). The site already passes `end` to YouTube as `endSeconds`.
- An end time before its start is caught before saving.
- **Sounds (game editor, built 1 Nov 2026):** under Cover art, a list of sounds per game: a name (shown on the button) and an audio file (mp3, ogg, wav or m4a, up to 1.5 MB). Each row has Play, Replace (or Choose file) and Remove; "+ Add sound" adds a row. New files upload on Save to `sounds/<game id>/<name>.<ext>` (name made from the label, `-2` added if taken), then `sounds: [{ "label", "file" }]` is saved on the game. Removing a sound deletes its file from the repo on the next Save and unticks it from every song. A row without a name or file stops the save with a message. Each sound gets an `id` on first save (made from its name, never changes after), and the file is named after it.
- **Sounds for this song (song editor, added 1 Nov 2026):** a tick box for each sound in the game's bank. Saved as `sounds: ["save-point", ...]` (sound ids) on the song; none ticked means it's left out and the song has no Sounds button. Sounds added but not saved yet can already be ticked.
- **Song volume (song editor):** "Starting volume" slider per song, saved as `volume` (0 to 100) on the song. "Use site default" removes it. Added 31 Oct 2026.
- **Site tab:** settings for everyone who visits, saved as `settings` in `config/games.json`: default starting volume for songs without their own (0 to 100, default 80) and how many seconds before the end "Next" shows (default 8, 0 turns auto next off). Saving starts the collector, which copies `settings` into `stories.json`.
- Pasting a YouTube link with `?t=` fills in the start time.
- Saving always loads the latest `config/games.json` first, applies the change, and retries up to 3 times if GitHub says the file changed in between ("does not match"). API calls use `cache: 'no-store'`, because GitHub lets browsers cache answers for 60 seconds and a cached copy caused that error on 31 Oct 2026.
- Saving writes `config/games.json` through the GitHub API, uploads the cover to `covers/<game id>.<ext>` (shrunk to 1600px), sets `cover` on the game, then starts the "Collect stories" workflow.
- It needs a fine-grained GitHub token, limited to Upliff/echolog, with Contents and Actions set to read and write. The token is kept only in that browser (localStorage). It's never in the repo or in chat.
- Song ids are made from the title and never change on edit, so hidden ids and links keep working. Game ids can't change after creation.
- **Inbox tab:** reads open issues from `Upliff/echolog-inbox` (set in Settings). A missing repo gives a plain message, not an error.
  - **Comments** show exactly as sent, with Approve and Decline. Approve adds the comment to `data/submitted.json`, labels the issue `accepted`, closes it, and starts the collector.
  - **Requests:** Accept (game or song) opens the editor filled in from the request, with a banner. Saving labels the issue `accepted` and closes it. Fix requests get "Mark done". Decline labels the issue `declined` and closes it.
  - The token needs **Issues: Read and write** on the inbox repo too.
- The collector passes `cover`, `sounds` and each song's `volume`, `fadeIn` and `fadeOut` through to `stories.json`. The front end already uses `game.cover` when it's set, and otherwise falls back to `covers/<id>.jpg|jpeg|png|webp`.

- **Times with milliseconds (added 1 Nov 2026):** every start and end box takes `1:23.456`, `83.456`, `1:02:03.5` or `1m23.456s` and saves decimal seconds rounded to the millisecond (`83.456`). Boxes show them back as `1:23.456` (trailing zeros dropped). Pasting a YouTube `?t=` link still gives whole seconds. Seconds over 59 in `m:ss` (e.g. `1:75`) are rejected.
- **Comments per scene (added 1 Nov 2026):** under each scene, "Comments for this scene (optional)" has its own "Videos to pull comments from" box (hint: "Leave empty to use the song's comments."), saved as `commentVideos` on that scene in `moments`. Empty means it's left out. A song can skip its own comment videos only if every scene has its own. The `moment` copy never includes the scene's `commentVideos` or `audio`.
- **Fade in / fade out (added 1 Nov 2026):** two boxes per song under Starting volume, in seconds (decimals ok, 0 to 30; empty or 0 = no fade). Saved as `fadeIn` / `fadeOut` on the song. Import files can set them too.
- **Every save starts "Collect stories" (1 Nov 2026):** the "Fetch comments after saving" tick box is gone (it had been left unticked, which is why Mohad's 9:58 save never reached the site). Game saves, imports, approved comments and Site tab saves all start the collector, try twice, and say in the status line if it didn't start (a 403 means the token is missing Actions: Read and write). "Fetch comments now" at the top still starts it by hand.
- **Import tab (added 1 Nov 2026):** drop or paste one or more import files (format in `docs/IMPORT.md`). Shows a preview per game: new game or adds to existing, each song as New or Already there (skipped unless "Replace the one already there" is ticked), thumbnails of each scene and music video linked to YouTube at the start time, the number of comment videos, the file's `note`, and warnings (unreadable links or times, no comment videos, no scene). Import merges in one save (with the same retry as other saves) and starts the collector. New games need cover art added in the Games tab.

### Admin page requests

Other chats add what they need from the admin page here. The admin chat builds it and then removes the line.


**Quota:** YouTube allows 10,000 units a day, and each page of 100 comments costs 1 unit. At 5 pages per video, that's roughly 5 units per video per run, so there's plenty of room.

**Saves only show on the site after a collector run.** The site reads `data/stories.json`, not `config/games.json`, so a change made in the admin page appears once "Collect stories" has run (about 30 seconds) and GitHub Pages has republished (a minute or two). The collector's push now retries up to 5 times, pulling in anything saved meanwhile: on 1 Nov 2026 a run failed because an admin save landed while it was running, so Kingdom Hearts II changes didn't show until it was run again.

**Run log:** each run writes a `log` list into `data/stories.json` showing how many comments each video gave, or why it failed. GitHub's own job logs can't be read from Claude's side, so check this instead. A video that gives `403` has comments turned off, so swap it for another.

**YouTube rules:** show the author's name and link back to the comment, and don't keep comment data older than 30 days. The nightly rebuild covers this.

## Data shape (data/stories.json)

```json
{
  "updated": "2026-11-01T05:17:00Z",
  "settings": { "volume": 80, "upNextSeconds": 8 },
  "games": [{
    "id": "ffx", "title": "Final Fantasy X", "year": 2001, "cover": "covers/ffx.jpg", "steamAppId": 359870,
    "sounds": [{ "id": "save-point", "label": "Save point", "file": "sounds/ffx/save-point.mp3" }],
    "songs": [{
      "id": "to-zanarkand", "title": "To Zanarkand", "composer": "Nobuo Uematsu", "volume": 70,
      "sounds": [{ "id": "save-point", "label": "Save point", "file": "sounds/ffx/save-point.mp3" }],
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

A scene with its own `commentVideos` gets its own `stories` list in `moments` (same shape as the song's, kept from the last run if YouTube can't be reached). Each song also gets `length` (seconds): its music track's end minus start, or its first scene's if there's no music track. Missing ends use the YouTube video's length, which the collector fetches each run (`videos?part=contentDetails`, 1 quota unit per 50 videos). The collector drops comments whose text is the same as one already kept (people often paste the same lyrics). Song `stories` come from YouTube, with approved own comments (`source: "echolog"`) first. Game-level `stories` are for Steam reviews, which are empty while Steam is off. `audio` is passed straight through from `config/games.json`. Game `sounds` is the whole bank; each song's `sounds` is just the ones ticked for it, already looked up (id, label, file), empty if none.

## FFX songs to check

- To Zanarkand and Otherworld: the clips are the opening. Check that they embed and start at the right second.
- Suteki da Ne: the clip is the Macalania scene, a fan upload. The song starts partway in, so `start` needs setting. A good one to try `audio` on.
- Besaid Island and Hymn of the Fayth: no clip chosen yet (`moment: null`). Auto next skips songs with nothing to play.

## Front end

**Only one chat edits the site: the site chat** (Mohad's chat for the front end, which rebuilt it on 31 Oct 2026). The site files are `index.html`, everything in `assets/`, `preview.bat`, `preview.ps1` and `.nojekyll`. Every other chat (the admin chat included) must not change them, not even a small fix. If another chat's work needs something on the site (a new field shown, a new setting used), it adds a line to "Site requests" below and tells Mohad to take it to the site chat. Data the admin page and collector write (`config/`, `data/`, `covers/`, `sounds/`) isn't site code and is fine for them to change. Added 1 Nov 2026, after the admin chat's fade change to `app.js` landed while the site chat was mid-change (both versions were merged by hand).

### Site requests

Other chats add what they need from the site here. The site chat builds it and then removes the line.

- (none)

Plain HTML, CSS and JS, no build step. It lives at the repo root, so GitHub Pages serves it as-is:

```
index.html               page shell: backdrop, top bar, video stage (scene + music players), dock, up-next bar, clouds layer, About dialog
assets/style.css    all styles
assets/app.js       everything else; all the settings are at the top
covers/                  one cover image per game (README.txt inside explains naming); the admin page uploads here
sounds/<game id>/        sound files for the Sounds button; the admin page uploads here
preview.bat + .ps1       local preview server for Windows without Python
.nojekyll                tells GitHub Pages to serve files as-is
```

- Routes use the hash: `#/` home, `#/ffx` game, `#/ffx/to-zanarkand` song, `#/ffx/otherworld/2` second scene.
- **Home page:** a search box (stays under the top bar) over a plain list of game names you can scroll. Typing filters the list by game name and song name (all words must match); Enter opens the first match. Hovering or matching a game shows its cover behind the page. The `[TAGLINE]` placeholder was taken off the home page on 1 Nov 2026 so it's just the list; put it back above the search box when Mohad has written it.
- **Song pages give the video the screen (1 Nov 2026):** instead of the top bar, three small round buttons sit in the top-left corner (stacked on desktop, in a row on phones; `html.song-page`, `--top` 0 on desktop, 60px on phones so they sit above the video): a house (home) and a record with the game's cover on its label, which spins once on hover and goes back to the game's song list. Other pages keep the normal top bar, which has About. (A "?" for About sat between them for a few hours; Mohad had it moved off song pages.) The video is the same size whether a song has one scene or several. (A menu button with a panel came first; Mohad found it gross, so it went the same day. The song list on hover went with it.)
- **Game page:** the line under the title shows the year and number of songs (no comment total). Each song shows its length instead of a comment count: the collector's `length`, or end minus start if the clip has one.
- **Comments have no name and no count on the site (1 Nov 2026):** no heading, no "60 comments" line, and the button in the strip under the video is just a down arrow. Empty state: "Nothing here yet." (Mohad tried calling them "echoes" and dropped it the same day.)
- Look: dark, Cormorant Garamond (titles, comments, clouds) and Karla (labels), gold accent `#e8c27a`. (A handwriting font, Caveat, was tried for comments on 1 Nov 2026; Mohad didn't like it, so it was taken out.)
- **Journal look (1 Nov 2026):** comments sit loose, with no boxes or lines, like thoughts in a journal. They spread across the whole width of the page: each one has a width set by its length (short 420px, mid 560px, long 720px) and its own place from left to right (`--pos`), plus a small tilt (up to 1.3 degrees), all worked out from its id (`seeded`) so it always looks the same. Short ones are written bigger (`c-short` / `c-mid` / `c-long`). On phones they're full width. **Scrolling reveals them:** each one fades in and rises into place as it comes into view (`reveal`, an IntersectionObserver; opacity and `translate` only). With reduced motion turned on they just show. A small pen stroke sits between them. Clouds are words straight on the scene (serif italic, no dark box), tilted up to 3 degrees, with a soft dark halo so they read over anything. The game's cover sits blurred behind every page. No cover image means a plain dark background.
- **Speed rules (keep these):** no `backdrop-filter` and no live CSS blur anywhere. The cover is drawn once into a small canvas shaped like the screen (`BG_DETAIL` = 160 pixels wide, cropped to fill like a photo set to "cover"), blurred once with the canvas's own blur (`BG_BLUR` = 2.5px), then stretched to the screen. It never moves; it only fades when the game changes. Phones get a lighter blur (0.6 times), since they only show a narrow slice of the cover. Safari, and so every iPhone browser, has no canvas blur, so there the same blur is done by hand on the small canvas (`handBlur`, runs once per game). Until 1 Nov 2026 Safari got a 40-pixel canvas instead, which looked smeared on iPhones, and before that everyone got a 32 x 32 square. Anything that animates only uses opacity or transform. The video changes size once and the move is animated with transform. Comments off screen aren't drawn (`content-visibility`). Fonts load without holding up the page.
- **Cover images:** any picture at least about 1280 pixels wide is plenty, since it's shown blurred. Landscape (16:9) suits desktop best; the middle of the image is what's kept on a phone. The admin page shrinks uploads to 1600 pixels.
- All comment text goes in through `textContent` (never `innerHTML`), with `white-space: pre-wrap` so line breaks stay.
- "Show more" is decided from the text (over 650 characters or 9 lines), so nothing is measured on screen. Shorter comments are never cut.
- `index.html` loads `style.css?v=24` and `app.js?v=29`. Bump the number after changes so browsers don't use old copies.
- Song page: the clip fills the screen apart from a strip at the bottom with the title, our own controls (play, sound, repeat, scrub bars) and a down arrow to the comments. The volume slider pops up above the sound button on hover or keyboard focus. **Volume** starts at, in order: the visitor's own choice for that song (saved in the browser as `echolog.volume:<game>/<song>`), the song's `volume`, the site default (`settings.volume`). Changing the slider only saves for the song playing. Repeat is remembered in the browser. Phones hide the volume slider (they use their own buttons). On phones the scrub bars get their own full-width rows under the title and buttons, with bigger handles, and the strip grows to fit them (the song name gets its own line above the buttons; `--peek` 112px, 156px with one bar, 188px with two, set by the `bars-one` / `bars-two` class on the page). YouTube's control bar is hidden (`controls: 0`). The strip is lifted above the video (`z-index: 12`) while hovered so the volume pop-up isn't hidden; `.view` must not keep its fade animation (no fill-mode), or the strip gets trapped under the video again.
- **Scrub bars**, measured from the clip's start, not from the start of the YouTube video. With a separate music track there are two that look different on purpose: **Music** (gold, thicker, note icon) moves the song; **Scene** (white, thin, film icon) moves only the picture and the song keeps going. Without a separate track there's one plain bar. A scene with no end runs to the end of its YouTube video, so its bar can be long; give scenes an end in the admin page.
- **Start-time safety net:** the same goes for the music track. If a scene is ever playing from before its start time (YouTube can ignore the start after an ad, and phones can refuse to jump until tapped), the site jumps it to where it should be: its start, or the matching point in the song when it's locked to a music track. Added 1 Nov 2026 after The Other Promise's scene (start 0:27) didn't start there on Mohad's screen.
- **Fades:** a song's `fadeIn` / `fadeOut` (seconds) ramp the playing track's volume from silent up to the normal level at the start of the song, and down to silent before its end, measured on the music track (or the clip, if there's no separate track). `fadeTick` runs every 100 ms and only touches the player's volume; the slider keeps showing the visitor's level. Repeat fades out and back in at the loop. Added 1 Nov 2026 by the admin chat.
- **Times with milliseconds:** YouTube's own start and end settings only take whole seconds, so the site starts players at the whole second, seeks to the exact time while they're held paused during loading, and stops the song itself when it reaches an end with milliseconds.
- **Comments per scene:** when a scene has its own comments, switching to it swaps the comment list and the clouds for that scene's. Scenes without their own show the song's.
- **Loading:** every song loads the same way, with or without a music track. The players load muted and hidden behind the loading screen: a dimmed still from the scene (YouTube's thumbnail for the video) slowly zooming in, the song name, a thin line with a gold piece gliding along it, and "Loading". Each one is held paused at its starting point as soon as it can play. The loading screen is solid, so the players under it (and the music player's YouTube title in the bottom-left) don't show through. **Never hide the players with opacity:** iPhones won't start a video that's see-through. From 1 Nov 2026 the layers were set to opacity 0 while loading, and on Mohad's iPhone nothing autoplayed after that; taken out the same day. When all of them are ready they start playing, still under the loading screen, and the loading screen only fades away (0.9 seconds, with the controls, scene bar and side buttons) once the video is really playing, so YouTube's own play button and title never show. If nothing has started on its own (5 seconds on phones, 12 on desktop, or 4 to 6 seconds after the players are ready), the loading screen shows our own Play button (`showStart` / `startByTap`); it stays up until the video really plays. Swapping scenes only covers the video. Changed 1 Nov 2026: before that the video was shown paused and then started, and on Mohad's iPhone YouTube's play button showed instead.
- **Captions:** turned off where possible (`cc_load_policy: 0`, and the captions module is unloaded on ready and on play). YouTube has no official switch, so a video may still show them.
- **Comments list:** one list, most liked first. No heading, no count, no sort buttons. The small player on desktop sits over the bottom-right of the page, so a comment can pass under it while scrolling.
- **Taps on the video** go to our own tap layer, not YouTube, so the scene and the music always pause and play together (letting YouTube take taps made it play then pause straight away). The bottom-right corner of the big video is left open so YouTube's "Skip ad" button still works. Tap the small player to make it big again. Space or K also plays/pauses.
- **Previous / next song:** strips flush with the left and right screen edges, from the top of the screen to the bottom (`SIDE_W` = 56px; the video is kept clear of them on desktop). On phones they're 40px, sit over the edges of the video and only go down to the bottom of the video, so they don't cover the controls. Hovering one with a mouse shows a card with a still from that song's scene, "Next song" or "Previous song", its name and length. They hide with the small player. Songs with nothing to play are skipped, and both wrap round.
- **Sounds button (1 Nov 2026):** a round gold button with a speaker and a little sparkle, at the right end of the strip under the video, only on songs whose own `sounds` list isn't empty (`song.sounds`, the ones ticked for that song in the admin page; `game.sounds` is the game's whole bank and isn't shown). It opens a panel from the bottom right with a pad per sound: each pad has its own colour, a ring when pressed, and little wave bars that bounce while its sound plays. Sounds play over each other and over the music, at the song's volume. Home and game pages have no Sounds button.
- **Scene picker:** when a song has more than one scene, a Scenes button (film icon and the current scene's name; just the icon on phones) sits at the right end of the strip, just left of the Sounds button, gold with the same glow. It opens a list headed "Scenes" (no count), lined up with its right edge, current scene in gold. The first time someone opens a song with several scenes, the button has a gold badge with the number of scenes; it goes once they open the list and never shows on that song again (`echolog.scenesSeen:<game>/<song>` in the browser). Until 1 Nov 2026 it was a bar of big buttons above the video, which made the video smaller; then a plain button next to repeat, until Mohad moved it beside Sounds the same day.
- Scrolling: on desktop the video shrinks to a 356 x 200 player in the bottom-right with a small bar under it. On phones the video slides away and a bar sits along the bottom. The bar has previous song, play/pause, next song and sound (the volume slider pops up on hover on desktop). No song name and no "back to the video" button since 1 Nov 2026; tapping the small player or scrolling up brings the video back.
- The players stay alive between songs, so the next song loads into the same player and starts quickly.
- **Auto next:** "Next: (song) in 8" appears that many seconds before the song ends, with "Play now" and "Stay", and the next song starts as soon as this one finishes. The number is `upNextSeconds` from the Site tab (0 turns it off). Seeking back hides it again. If a clip ends early or fails, a 5-second countdown shows instead. Songs with no clip are skipped. After the last song it goes back to the first.
- **Repeat:** the repeat button (gold with a dot when on) is one setting for the whole site: once on, it stays on for every song until turned off (saved in that browser as `echolog.repeat`, so a phone and a computer each have their own). It loops the song with no gap and no loading screen: just before the end, the music jumps back to its start and keeps playing. With a separate music track the picture doesn't jump back; it carries on (the seconds already played are added to where the scene should be, `media.extra`). Without one, the video is the song, so it goes back to its start. "Next" doesn't show while repeat is on. Scenes always loop on their own while you stay on the page.
- **Music over the scene:** two players. The scene is on top and always muted; the music player sits under it at 200 x 200 (YouTube's minimum). **Starting together:** see Loading above; once both are ready they start together and the music is unmuted. After 15 seconds (`MUSIC_WAIT_MS`) the video is shown anyway. If the music player has loaded but hasn't started (often an ad playing on it, on a phone not signed in to YouTube Premium), it's kept: the scene waits at its start and joins the music when it plays. Only a music player that never loaded is dropped, and then the scene plays with its own sound. **Phones (no Play button):** if the music hasn't started 4 seconds after the scene is ready (and isn't buffering), the scene plays by itself, muted, and the loading screen goes, with "Tap for sound" showing (`sceneAlone`, `media.musicWait`). That tap (or the play or sound button) starts the music from the point the scene has reached, unmuted, and the scene locks to it (`wakeMusic`). If the music still hasn't started 4 seconds after the tap, the scene's own sound is used: "Tap for sound" shows again, and that tap turns it on (unmuting without a tap would make the phone pause it). Our Play button only shows on a phone if even the scene won't start (never while the scene is held for the music, or while the music hasn't started; it was still showing there until v29). **Ads after the tap:** on Mohad's iPhone, "Tap for sound" on To Zanarkand played something else, almost certainly an ad on the hidden music player. On phones `adWatch` now spots it after 1.2 seconds (2 on desktop), brings the music player up over the scene with the "Ad playing" label so it can be seen and skipped, and the scene waits; the give-up timer doesn't drop the music while an ad is on. Changed 1 Nov 2026: before that, phones held everything behind our Play button, and on Mohad's iPhone the button just went back to Loading for To Zanarkand and Otherworld (Besaid Island, also with a music track, worked, so it's likely those two music uploads, e.g. an ad that needs a tap). When the music is dropped, its player is kept (paused and muted) rather than destroyed, so the next song tries the music again in a player that has already played. Until 1 Nov 2026 the music was dropped straight away and its player destroyed, and on Mohad's iPhone every song after the first drop then fell back to the scene's sound. Pressing play then used to start the hidden music player, which iPhones opened full screen. Until 1 Nov 2026 a slow music track was always dropped, which is why The Other Promise played the scene's own sound on Mohad's phone. If only the scene is late, the music starts and the picture joins when it's ready. The scene only plays while the music is actually playing (not while it's loading or buffering). **Locked together:** the picture is kept within 0.8 seconds of where it should be for the music. If the scene is shorter than the song, it wraps round (the position is worked out from the song, so a loop lands in the right place). Dragging the Scene bar turns this off until the next song or scene switch. Play/pause and the seek bar control the music, and the scene follows. If the music video fails, the scene's own sound comes back. Whenever the music is dropped, a short note shows at the bottom of the video for 7 seconds saying why (didn't load, didn't start on this phone, can't be played on other sites (error 101/150: pick another upload), or couldn't be played).
- **Swapping scenes** opens the new scene at the point the song has reached (its start plus how far into the song we are, wrapping round if the scene is shorter). With the same music track, the music keeps playing and only the picture changes. A scene with its own music, or a song with no music track, reloads and starts that far in. People can drag the Scene bar anywhere after that.
- Clouds: while the big video is playing, short comments (200 characters or less, best 30 by score, shuffled) fade in one at a time in the corners and sides of the video, never the middle. Every one shows once before any comes round again, and the last few shown are put at the back when the list starts over, so nothing repeats back to back. They alternate left and right, stay up for reading time (about 16 characters a second, 6.5 to 14 seconds), drift slightly, then fade out. They stop when the video is paused, small, or the tab is hidden. On phones there's one at a time, just under the video. Settings at the top of `app.js`.
- **Known rule breaks (Mohad's choice):** YouTube's embed rules don't allow anything on top of the player, and don't allow separating a video's audio from its picture or hiding a player. Clouds over the video break the first; the music track under a muted scene breaks the other two. The risk is YouTube suspending the API key the collector uses. Clouds can be moved beside the video with `CLOUDS_OVER_VIDEO = false`. To drop the music overlay, remove `audio` from the songs.
- Missing video: the stage says the clip is unavailable and the next song countdown starts. YouTube script blocked: the stage says so, comments still work.
- If the browser blocks sound, the clip starts muted and the sound button turns gold.
- **Sound on phones:** phones stop a video that's unmuted without a tap, so on touch screens songs always start muted, and a gold "Tap for sound" button sits at the bottom of the video until the sound is turned on (`media.soundOk`; it stays on for the rest of the visit). Added 1 Nov 2026 after autoplay stopped working on Mohad's iPhone. Not tested on a real iPhone from Claude's side.
- **Testing without editing data** (add before the `#`, only applies to the song the page opened on):
  - `?t=1:35` scene start, e.g. `http://localhost:8000/?t=1:35#/ffx/suteki-da-ne`
  - `?audio=VIDEOID` music track to lay over the scene, `?at=0:12` music start
  - `?debug` shows a box with what each player is doing (playing, paused, muted, time, length, the YouTube video id it reports) and the phone flags. A screenshot of it on a phone shows where a song gets stuck.
  - The real values go in `config/games.json`.
- Local preview: in the repo folder run `python -m http.server 8000` and open `http://localhost:8000`. `preview.bat` also works. Opening `index.html` straight from disk won't load the data.
- Tested in headless Chromium at 1280x800 and 390x844 with a fake YouTube player. Not tested against real YouTube from Claude's side.

## Known issues (front end)

- The big video shrinking on desktop: fixed in the rebuild. The "calm" shrink only happens when `CLOUDS_OVER_VIDEO` is false.
- The start time backup jump only fires if the player really ignored `start`, so the clip shouldn't jump twice. Worth a check on real YouTube.
- Auto next onto a new song after the page has been idle may start muted if the browser blocks sound. The gold sound button shows when that happens.
- Mini player is 356x200 on desktop because of YouTube's 200x200 minimum.
- Otherworld and To Zanarkand: music starting after the video. Likely cause: the scene was allowed to play while the music was still loading, and the old 6-second give-up started the scene alone. Fixed 1 Nov 2026 (scene waits for the music to really play, 15-second wait, picture locked to the music). Not tested on real YouTube yet. If the music still comes in late, check for an ad on the music video (it plays hidden under the scene), or silence at the start of the music upload. Mohad set Otherworld's music start to 0:01 while testing; set it back to 0:00 if the start of the song is cut off.
- **Ads:** YouTube can show ads in the embedded player on any video that's monetised, by the uploader or by a Content ID claim (Square Enix claims are likely on custom uploads). The site can't turn them off and earns nothing from them. Autoplayed embeds tend to get fewer ads, but there's no guarantee. Hiding or covering ads is against YouTube's developer policies ("Restricting ads from playing"), so Mohad decided on 1 Nov 2026 to leave them visible and just make it clear when one is on.
- **"Ad playing" label (added 1 Nov 2026):** YouTube doesn't tell the site when an ad is on, so `adWatch` guesses: a player that says it's playing while its own time stands still for 2 seconds is almost always on an ad. Then "Ad playing. The song starts after it." shows in gold, top left of the video. If it's the hidden music player, that player is brought up over the scene (full size, above the tap layer) so the ad can be seen and skipped, and the scene waits. For an ad on the scene while it's locked to the music, the lock stops moving the scene once it has stood still on its own for 1.5 seconds, and picks up again when it moves. It's a guess: a video that freezes while saying it's playing would show the label too. Not tested against real YouTube ads from Claude's side.

## Own comments, requests and hiding names (planned)

Mohad asked for these on 31 Oct 2026. **Built so far:** the admin Inbox tab, and the collector merging `data/submitted.json`. **Not built yet:** the inbox repo, the Worker, the site forms, and the hide names switch.

### How it fits together

```
site form  ->  Cloudflare Worker  ->  issue in private repo Upliff/echolog-inbox
admin page Inbox tab  ->  reads those issues  ->  approve / accept / decline
approved comment  ->  data/submitted.json in Upliff/echolog  ->  collector merges it into stories.json
accepted request  ->  opens the game/song editor filled in  ->  normal save
```

- **Why a Worker:** the site is static, and a GitHub token can't sit in public site code. The Worker holds a fine-grained token (Issues read and write on `Upliff/echolog-inbox` only) as a Worker secret. Cloudflare's free plan covers this.
- **Inbox repo:** `Upliff/echolog-inbox`, private, issues only. Labels: `comment`, `request`, then `accepted` or `declined` when dealt with. Issues are closed once dealt with.
- **Worker code** can live in the public repo under `worker/` (no secrets in it). Mohad deploys it from his Cloudflare account and adds the token secret there. Never paste the token in chat.
- **Worker endpoints:** `POST /comment` and `POST /request`, JSON in, `{ "ok": true }` out.
- **Spam and abuse:** only accept requests from the site's own address and localhost; Cloudflare Turnstile check (free, no puzzles for most people); a hidden honeypot field; length limits; a simple per-IP rate limit (for example 5 an hour). Don't store IP addresses or emails in the issue.
- **Issue body:** the submitted fields as JSON in a fenced code block, so the admin page can read them back exactly. Title like `Comment: To Zanarkand` or `Request: Kingdom Hearts`.

### Own comments (site)

- On each song page, under the comments: a short form. Fields: comment (required, up to 3000 characters, line breaks kept), name (optional). Button: "Send".
- Under the form, plain text: comments are only posted after they're checked, and not to include anything private. Mohad can reword this.
- After sending: "Thanks. It'll show up once it's checked." On failure: "Couldn't send that. Try again later."
- Issue JSON: `{ "game": "ffx", "song": "to-zanarkand", "text": "...", "name": "..." | null, "sent": "2026-10-31T10:17:00Z" }`.

### Requests (site)

- A "Request" link in the top bar next to About. It opens a dialog like About.
- Fields: what kind (a game, a song, a fix), game, song (optional), link (optional, e.g. a YouTube video of the scene), note (optional, up to 1000 characters). Button: "Send".
- Issue JSON: `{ "kind": "game" | "song" | "fix", "game": "...", "song": "...", "link": "...", "note": "...", "sent": "..." }`.

### Admin page: Inbox tab

- New tab next to Games, with two lists: Comments and Requests. Shows open issues only, newest first, with a count on the tab.
- The admin's GitHub token also needs Issues read and write on `Upliff/echolog-inbox` (add that repo to the same fine-grained token).
- **Comments:** show the text exactly as sent, the name (or "No name"), the game and song, and the date. "Approve" adds it to `data/submitted.json` in `Upliff/echolog` (text untouched), labels the issue `accepted` and closes it. "Decline" labels it `declined` and closes it. No editing of the text.
- **Requests:** show all the fields. "Accept" opens the add-game editor (or that game's editor, for a song) with the name, song and link filled in. Saving labels the issue `accepted` and closes it. "Decline" labels it `declined` and closes it.
- After approving comments, start the "Collect stories" workflow so they show up.

### Approved comments (data)

- `data/submitted.json` in `Upliff/echolog`: `{ "comments": [{ "id": "user:12", "game": "ffx", "song": "to-zanarkand", "author": "name" | null, "text": "...", "date": "2026-10-31" }] }`. The number is the inbox issue number.
- The collector merges these into each song's `stories` with `"source": "echolog"`, `"likes": 0`, no `authorUrl` and no `url`. `hidden.txt` still applies, so `user:12` there hides it.
- They aren't YouTube data, so the 30-day rule doesn't apply. They stay until removed.
- Front end: author shows the name, or "Anonymous" if none. No author link. Instead of "View on YouTube", show nothing (or "Posted on Echolog"). They can show up as clouds like any other short comment. The list is sorted by likes, so they come last for now.

### Hide names (site)

- A "Hide names" switch in the comments heading row on song pages (and above Steam reviews on the game page if those ever show).
- When on, the author name is hidden on every comment, in the list and in the clouds. Likes, date and the "View on YouTube" link stay.
- Off by default. Remembered in that browser (localStorage, wrapped in try/catch).
- This is a viewer setting only. The data and the admin page still have the names.
- **Known rule break (Mohad's choice):** YouTube's rules say to show the author's name with their comment. Hiding them breaks that while the switch is on.

## More than one scene per song (planned)

Mohad asked for this on 31 Oct 2026: a song can have several scenes (it often plays more than once in a game), and people can swap between them.

- **Data:** songs get `moments`, a list of scenes in the order they happen in the game. Each one is the same shape as `moment` now: `{ "videoId", "start", "end", "label" }`, plus an optional `audio` of its own. The song-level `audio` is used for any scene without its own.
- **Old data keeps working:** a song with only `moment` is treated as a one-item `moments` list. Once everything uses `moments`, `moment` can go.
- **Collector:** passes `moments` through to `stories.json` (built). Songs with only `moment` get a one-item `moments` list.
- **Built:** the admin scene list, the collector, and the scene buttons on the song page (31 Oct 2026). Scene buttons show "Scene 1", "Scene 2" when a scene has no label.
- **Song page:** if there's more than one scene, the Scenes button in the controls lists each scene's `label` (for example "Opening" and "Ending"); see "Scene picker" above. The current one is marked (`aria-current`). Tapping one loads that scene into the same player straight away, at the point the song has reached; the music keeps playing if it's the same track. The comments and scroll position don't reset. The list scrolls if it's long.
- **Link:** the scene number goes in the hash, `#/ffx/to-zanarkand/2` for the second scene. No number means the first. A number that doesn't exist falls back to the first.
- **Auto next:** when the scene playing ends, the next song starts as now. It doesn't run through the other scenes of the same song first.
- **Admin page:** in the song editor, "Scene" is a list with "Add scene", remove and reorder. Each scene has a link (with `?t=` start), end and label, and an optional music track (built).
- **Labels** are short and plain, written by Mohad ("Opening", "Ending", "Macalania").

## Next steps

1. Check the site against real YouTube: start times, auto next, sound, To Zanarkand and Otherworld starting together, captions off, loading screen.
2. Pick `audio` tracks for songs where the scene has talking over the music (Suteki da Ne first), and add them to `config/games.json`.
3. Read through the results. Add bad ones to `hidden.txt`, and tweak `STORY_PHRASES` and `MIN_SCORE` in `collect.py` if needed.
4. Turn on GitHub Pages: Settings, then Pages, then Deploy from a branch, main, / (root). The site will be at https://upliff.github.io/echolog/.
5. Own comments, requests and hide names: create the private inbox repo, write the Worker, add the site forms and the switch. (The admin Inbox tab and the collector merge are done.) Mohad: make a Cloudflare account and get a Turnstile site key.
6. Give the scenes labels in the admin page (Otherworld's two scenes show as "Scene 1" and "Scene 2" for now).
