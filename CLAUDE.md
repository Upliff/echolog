# Echolog: project notes

Read this first in any chat about Echolog. Keep it up to date when something changes.

## What it is

A site where you pick a game, then a song from it. The clip of the moment the song first plays in the game runs, the video shrinks into a mini player, and real comments from people about what that song or game meant to them scroll underneath.

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
- **Front end:** Mohad plans to build it with Claude Design. It reads `data/stories.json`.
- **First game:** Final Fantasy X, with 5 songs (see `config/games.json`).

## Accounts and setup status

- Google Cloud project "Game Stories" (id `leafy-tenure-513307-e2`), with YouTube Data API v3 enabled. The API key is restricted to that API.
- GitHub repo secret `YOUTUBE_API_KEY` is added. Never put the key in code, chat or the site.
- Done: repo created, secret added, Claude GitHub App installed on the repo (Claude can push), and the first runs completed (31 Oct 2026). 196 stories across the 5 FFX songs.
- Not done yet: GitHub Pages turned on.
- Not done yet: the front end.

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
- `moment` sets the clip that plays first: the YouTube `videoId` plus a `start` time in seconds. Use `null` if there's no clip yet.
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
      "stories": [{ "id": "yt:...", "source": "youtube", "author": "@name", "authorUrl": "...",
                    "text": "...", "likes": 5400, "date": "2019-04-01", "url": "...", "videoId": "...", "score": 19.2 }]
    }],
    "stories": [{ "id": "steam:...", "source": "steam", "author": "Steam player", "authorUrl": "...",
                  "text": "...", "likes": 300, "date": "2020-09-13", "url": "...", "hoursPlayed": 100, "score": 12.4 }]
  }]
}
```

Song `stories` come from YouTube. Game-level `stories` are for Steam reviews, which are empty while Steam is off.

## FFX songs to check

- To Zanarkand and Otherworld: the clips are the opening. Check that they embed and start at the right second.
- Suteki da Ne: the clip is the Macalania scene, a fan upload. The song starts partway in, so `start` needs setting.
- Besaid Island and Hymn of the Fayth: no clip chosen yet (`moment: null`).

## Next steps

1. Read through the results. Add bad ones to `hidden.txt`, and tweak `STORY_PHRASES` and `MIN_SCORE` in `collect.py` if needed.
2. Build the front end in Claude Design using `DESIGN_BRIEF.md`.
3. Turn on GitHub Pages (Settings, then Pages, deploy from the main branch).
