# Echolog import files

An import file adds games and songs in bulk. Mohad drops it into the **Import** tab of the admin page, checks the preview, then presses Import. A Claude chat can also add one straight to `config/games.json` (see "Adding straight to the site" below).

## Format

```json
{
  "echologImport": 1,
  "games": [
    {
      "title": "Kingdom Hearts",
      "year": 2002,
      "songs": [
        {
          "title": "Dearly Beloved",
          "composer": "Yoko Shimomura",
          "scenes": [
            { "video": "https://www.youtube.com/watch?v=VIDEOID", "start": "0:42.250", "end": "2:10", "label": "Title screen",
              "commentVideos": ["https://youtu.be/VIDEOID"] }
          ],
          "music": { "video": "https://youtu.be/VIDEOID", "start": "0:00", "end": "2:35" },
          "commentVideos": ["https://youtu.be/VIDEOID", "https://youtu.be/VIDEOID"],
          "volume": 70,
          "note": "Anything Mohad should check, e.g. the start time is a guess"
        }
      ]
    }
  ]
}
```

- **Required:** `games[].title` and, for each song, `title`. Everything else is optional.
- **`video`** can be a full YouTube link (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`) or just the 11-character id. A link with `?t=` sets the start time if `start` isn't given.
- **Times** can be `"1:35"`, `"1:35.250"`, `"95"`, `95.25` or `"1m35s"`, to the millisecond. `end` is optional.
- **`scenes`** are the moments the song plays in the game, in the order they happen, so the first one is when it first plays. Each scene can have its own `music`, and its own `commentVideos` (left out = the scene uses the song's comments). `label` is short and plain ("Opening", "Ending").
- **`music`** (optional) is a clean soundtrack upload, played over a scene that has talking over the song.
- **`commentVideos`**: 2 to 4 popular uploads of the song (official soundtrack uploads, well known fan uploads) with lots of comments.
- **`volume`** (optional) is 0 to 100. Leave it out to use the site default.
- **`note`** shows in the admin preview and isn't saved.
- Games are matched to existing ones by name (or `id`). Songs are matched by name. Songs that already exist are skipped unless Mohad ticks "Replace" in the preview.

## Rules for the chat making the file

- **Never make up a video id.** Every link must come from a page you actually opened or a search result you actually saw. If you can't find a good video, leave that field out and say so in `note`.
- **Start and end times:** only give a time you found somewhere real (the video's chapters, its description, a pinned or popular comment with timestamps). Otherwise use `"start": 0` and write "start time needs checking" in `note`. Never guess.
- Prefer official uploads (the publisher's channel, e.g. SQUARE ENIX MUSIC) for `music` and `commentVideos`, and a clean, well-viewed cutscene or longplay upload for `scenes`.
- Check that comment videos actually have comments: avoid "made for kids" uploads and videos with comments turned off.
- "Popular songs" means songs people talk about: the main theme, the most played battle theme, the song tied to the big emotional scene. 3 to 6 per game is a good start.
- Song and game names as fans know them, in plain English where there's a common English name.
- Save the file as `imports/<game-id>.json` in the local EchoLog folder (`C:\Users\Upliff\Documents\EchoLog\imports`), then tell Mohad to drop it into the Import tab.

## Adding straight to the site

Only when Mohad asks for it directly ("add it to the site"):

1. Pull the repo and read `config/games.json`.
2. Add the new games and songs in the same shape the admin page saves: each song has `id` (made from the title: lowercase, spaces to `-`), `title`, `composer`, `moments` (list of `{ videoId, start, end, label }`), `moment` (a copy of the first scene without its `audio`, or `null`), `audio` (`{ videoId, start, end }` or `null`), `commentVideos` (ids only), and `volume` only if set. New games get `id`, `title`, `year`, `songs`.
3. Never change or remove existing songs unless Mohad says so.
4. Check the JSON parses, commit with a message like `Add Kingdom Hearts songs`, push, then start the "Collect stories" workflow.
5. Tell Mohad what was added and anything in the notes he should check in the admin page.
