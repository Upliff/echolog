# Echolog: brief for the front end

## The flow

1. **Home:** a list or grid of games.
2. **Game page:** the songs from that game.
3. **Song page:**
   - The clip starts big, near full screen, at the moment the song first plays in the game. It uses the YouTube embed with `moment.videoId` and `moment.start`.
   - When the clip ends, or as soon as the person scrolls, the video shrinks into a small player pinned to a corner. The music keeps playing.
   - The comments scroll underneath. Tapping the mini player makes it big again.
   - If `moment` is `null`, skip the big intro and just show the comments.
4. The game's Steam reviews get their own section on the game page, or below the song comments.

## Data

- Read `data/stories.json`. It sits in the same repo and is rebuilt nightly.
- While designing, use `data/sample-stories.json`, which has the same shape. CLAUDE.md has the full shape.

## Each comment shows

- The text, exactly as written. Keep line breaks. Never shorten it without a "show more".
- The author's name, linked to `authorUrl`.
- The likes count and the date.
- A link to the original (`url`). YouTube requires this.
- Steam reviews also show `hoursPlayed`, e.g. "312 hrs played".

## Writing on the site

- Keep it short and plain. No AI-sounding copy: no taglines like "every song tells a story", no "journey", no "timeless".
- Mohad writes the tagline and about text. Leave clear placeholders like `[TAGLINE]`.

## Tech

- A static site on GitHub Pages: plain HTML, CSS and JS, with no build step and no server.
- It has to work well on phones.
- Use the official YouTube IFrame Player API for the clip and mini player.
