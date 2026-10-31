"""Echolog collector.

Pulls YouTube comments (from soundtrack videos) and Steam reviews for every
game in config/games.json, keeps the ones that read like personal stories,
and writes data/stories.json for the site to read.

Runs nightly from GitHub Actions. Standard library only.

Env:
  YOUTUBE_API_KEY   required for YouTube (Steam needs no key)
"""

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "games.json")
HIDDEN = os.path.join(ROOT, "data", "hidden.txt")
SUBMITTED = os.path.join(ROOT, "data", "submitted.json")
OUT = os.path.join(ROOT, "data", "stories.json")

YT_PAGES_PER_VIDEO = 5        # 100 comments per page, 1 quota unit per page
STEAM_PAGES = 10              # 100 reviews per page
MAX_STORIES_PER_SONG = 60
MAX_STORIES_PER_GAME = 40     # Steam reviews, per game
MIN_SCORE = 4.0
MIN_LENGTH = 90

# Steam shut its public review endpoint (store.steampowered.com/appreviews) in
# Oct 2026. The replacement needs a publisher key, so this is off for now.
STEAM_ENABLED = False

# Phrases that tend to show up when someone is telling a real story.
STORY_PHRASES = [
    "my dad", "my father", "my mom", "my mum", "my mother", "my brother",
    "my sister", "my son", "my daughter", "my wife", "my husband",
    "my girlfriend", "my boyfriend", "my grandma", "my grandpa", "my nan",
    "my grandmother", "my grandfather", "my uncle", "my aunt", "my cousin",
    "my best friend", "my friend", "my family", "my kids",
    "passed away", "funeral", "hospital", "lost my", "miss him", "miss her",
    "miss you", "childhood", "growing up", "when i was", "years ago",
    "years old", "back then", "back in", "first time", "first game",
    "got me through", "hard time", "rough time", "dark time", "depression",
    "cried", "crying", "tears", "remember", "memories", "still makes me",
    "still gives me", "every time", "to this day", "never forget",
    "changed my life", "my life", "used to play", "we played", "played it with",
    "played this with", "i was 8", "i was 9", "i was 10", "i was 11",
    "i was 12", "i was 13", "i was 14", "i was 15", "i was 16",
]

# Things that usually mean it's not a story.
JUNK = [
    "http://", "https://", "spotify", "subscribe", "who's here in",
    "who is here in", "anyone here in", "anyone listening in", "who's listening in",
    "like if you", "like this comment", "check out my", "my channel",
]
TIMESTAMP = re.compile(r"\b\d{1,2}:\d{2}\b")


def fetch_json(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body)
            except ValueError:
                raise ValueError(f"not JSON, got: {body[:150]!r}")
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def score(text, likes):
    """Rough 'is this a personal story' score. Higher is better."""
    t = text.lower()
    if len(t) < MIN_LENGTH:
        return 0.0
    if any(j in t for j in JUNK):
        return 0.0
    if len(TIMESTAMP.findall(t)) >= 2:   # timestamp lists, not stories
        return 0.0
    hits = sum(1 for p in STORY_PHRASES if p in t)
    if hits == 0:
        return 0.0
    length_bonus = min(len(t), 1200) / 300          # up to 4
    first_person = min(len(re.findall(r"\b(i|me|my)\b", t)), 10) / 5  # up to 2
    return hits * 2 + length_bonus + first_person + math.log10(max(likes, 0) + 1)


def load_submitted():
    """Comments people sent through the site and Mohad approved, keyed by (game, song)."""
    if not os.path.exists(SUBMITTED):
        return {}
    with open(SUBMITTED, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for c in data.get("comments", []):
        if not c.get("id") or not c.get("text"):
            continue
        out.setdefault((c.get("game"), c.get("song")), []).append({
            "id": c["id"],
            "source": "echolog",
            "author": c.get("author") or None,
            "authorUrl": "",
            "text": c["text"],
            "likes": 0,
            "date": c.get("date", ""),
            "url": "",
        })
    return out


def load_hidden():
    if not os.path.exists(HIDDEN):
        return set()
    with open(HIDDEN, encoding="utf-8") as f:
        return {ln.split("#")[0].strip() for ln in f if ln.split("#")[0].strip()}


# ---------- YouTube ----------

def youtube_comments(video_id, key):
    out, token = [], None
    for _ in range(YT_PAGES_PER_VIDEO):
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": 100,
            "order": "relevance",
            "textFormat": "plainText",
            "key": key,
        }
        if token:
            params["pageToken"] = token
        data = fetch_json("https://www.googleapis.com/youtube/v3/commentThreads?" + urllib.parse.urlencode(params))
        for item in data.get("items", []):
            s = item["snippet"]["topLevelComment"]["snippet"]
            cid = item["snippet"]["topLevelComment"]["id"]
            out.append({
                "id": f"yt:{cid}",
                "source": "youtube",
                "author": s.get("authorDisplayName", ""),
                "authorUrl": s.get("authorChannelUrl", ""),
                "text": s.get("textDisplay", "").strip(),
                "likes": int(s.get("likeCount", 0)),
                "date": s.get("publishedAt", "")[:10],
                "url": f"https://www.youtube.com/watch?v={video_id}&lc={cid}",
                "videoId": video_id,
            })
        token = data.get("nextPageToken")
        if not token:
            break
    return out


# ---------- Steam ----------

def steam_reviews(app_id):
    out, cursor = [], "*"
    for _ in range(STEAM_PAGES):
        params = {
            "json": 1, "filter": "all", "language": "english",
            "review_type": "all", "purchase_type": "all",
            "num_per_page": 100, "cursor": cursor, "day_range": 365,
        }
        data = fetch_json(f"https://store.steampowered.com/appreviews/{app_id}?" + urllib.parse.urlencode(params))
        reviews = data.get("reviews", [])
        for r in reviews:
            a = r.get("author", {})
            sid = a.get("steamid", "")
            out.append({
                "id": f"steam:{r['recommendationid']}",
                "source": "steam",
                "author": "Steam player",
                "authorUrl": f"https://steamcommunity.com/profiles/{sid}" if sid else "",
                "text": r.get("review", "").strip(),
                "likes": int(r.get("votes_up", 0)),
                "date": datetime.fromtimestamp(r.get("timestamp_created", 0), timezone.utc).strftime("%Y-%m-%d"),
                "url": f"https://steamcommunity.com/profiles/{sid}/recommended/{app_id}/" if sid else "",
                "hoursPlayed": round(a.get("playtime_forever", 0) / 60),
            })
        new_cursor = data.get("cursor")
        if not reviews or not new_cursor or new_cursor == cursor:
            break
        cursor = new_cursor
    return out


def pick(items, hidden, limit):
    seen, keep = set(), []
    for it in items:
        if it["id"] in hidden or it["id"] in seen:
            continue
        seen.add(it["id"])
        s = score(it["text"], it["likes"])
        if s >= MIN_SCORE:
            it["score"] = round(s, 2)
            keep.append(it)
    keep.sort(key=lambda x: x["score"], reverse=True)
    # The same text posted more than once (often copied lyrics): keep only the best-scoring copy.
    texts, unique = set(), []
    for it in keep:
        t = " ".join(it["text"].split()).lower()
        if t in texts:
            continue
        texts.add(t)
        unique.append(it)
    return unique[:limit]


def main():
    with open(CONFIG, encoding="utf-8") as f:
        config = json.load(f)
    previous = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            previous = json.load(f)
    prev_games = {g["id"]: g for g in previous.get("games", [])}

    hidden = load_hidden()
    submitted = load_submitted()
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if not key:
        print("No YOUTUBE_API_KEY set, skipping YouTube.", file=sys.stderr)

    games_out = []
    log = []
    for game in config["games"]:
        print(f"{game['title']}")
        prev = prev_games.get(game["id"], {})
        prev_songs = {s["id"]: s for s in prev.get("songs", [])}
        songs_out = []

        for song in game.get("songs", []):
            raw, ok = [], bool(key)
            if key:
                for vid in song.get("commentVideos", []):
                    try:
                        got = youtube_comments(vid, key)
                        print(f"  {song['title']} / {vid}: {len(got)} comments")
                        log.append(f"{game['id']}/{song['id']}/{vid}: {len(got)} comments")
                        raw.extend(got)
                    except Exception as e:  # noqa: BLE001
                        ok = False
                        print(f"  {song['title']} / {vid}: failed ({e})", file=sys.stderr)
                        log.append(f"{game['id']}/{song['id']}/{vid}: failed ({e})")
            if ok or raw:
                stories = pick(raw, hidden, MAX_STORIES_PER_SONG)
            else:
                # keep last run's stories if YouTube was unreachable
                stories = [s for s in prev_songs.get(song["id"], {}).get("stories", []) if s["id"] not in hidden]
            own = [c for c in submitted.get((game["id"], song["id"]), []) if c["id"] not in hidden]
            stories = own + [x for x in stories if x["id"] not in {c["id"] for c in own}]
            moments = song.get("moments") or ([song["moment"]] if song.get("moment") else [])
            songs_out.append({
                "id": song["id"],
                "title": song["title"],
                "composer": song.get("composer", ""),
                "volume": song.get("volume"),
                "moment": song.get("moment") or (moments[0] if moments else None),
                "moments": moments,
                "audio": song.get("audio"),
                "stories": stories,
            })

        steam = []
        if STEAM_ENABLED and game.get("steamAppId"):
            try:
                raw = steam_reviews(game["steamAppId"])
                print(f"  Steam: {len(raw)} reviews")
                log.append(f"{game['id']}/steam: {len(raw)} reviews fetched")
                steam = pick(raw, hidden, MAX_STORIES_PER_GAME)
            except Exception as e:  # noqa: BLE001
                print(f"  Steam failed ({e}), keeping previous", file=sys.stderr)
                log.append(f"{game['id']}/steam: failed ({e})")
                steam = [s for s in prev.get("stories", []) if s["id"] not in hidden]

        games_out.append({
            "id": game["id"],
            "title": game["title"],
            "year": game.get("year"),
            "cover": game.get("cover"),
            "sounds": game.get("sounds") or [],
            "steamAppId": game.get("steamAppId"),
            "songs": songs_out,
            "stories": steam,
        })

    result = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "settings": config.get("settings") or {},
        "games": games_out,
        "log": log,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    total = sum(len(s["stories"]) for g in games_out for s in g["songs"]) + sum(len(g["stories"]) for g in games_out)
    print(f"Wrote {total} stories to data/stories.json")


if __name__ == "__main__":
    main()
