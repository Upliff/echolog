"""Echolog collector.

Pulls YouTube comments from the soundtrack videos in config/games.json, keeps
the ones that read like personal stories, and writes the data the site reads.

How it spends the YouTube quota (10,000 units a day, 1 unit per request):
  - A comment video seen for the first time gets a deep pull: the top
    comments (DEEP_PAGES pages of 100) plus the newest page. The ones worth
    reading go into the comment pool, for Mohad to choose from.
  - Once a week each game is checked: only comments posted since the last
    check are fetched, and the comments shown on the site are fetched again
    by id (50 per unit) so likes stay current and deleted ones go.
  - Runs started by a save (workflow_dispatch) only do the deep pulls, so a
    save never re-fetches the whole catalogue.
  - Every run stops at DAILY_BUDGET units for the day. Anything left waits
    for the next run.

Files:
  config/games.json        games, songs, comment videos (admin page writes)
  data/picks.json          comments Mohad chose per song or scene (admin page writes)
  data/repull.txt          "VIDEOID DATE" lines: deep pull that video again (admin page writes)
  data/hidden.txt          ids never to show
  data/submitted.json      approved own comments
  data/index.json          list of games for the home page, plus the run status
  data/games/<id>.json     one game with its songs and comments
  data/stories.json        everything in one file (old format; off since 2 Nov 2026, WRITE_STORIES_JSON)
  POOL_DIR/state.json      when each video and game was last fetched, quota used today
  POOL_DIR/videos/<id>.json.gz   comment pool for one video

POOL_DIR is a checkout of the repo's `pool` branch, which is replaced on every
run (no history), so the pool doesn't make the repo grow.

YouTube's rules: no comment data older than 30 days. Comments shown on the
site are fetched again weekly; pool comments nobody picked are dropped after
KEEP_DAYS.

Env:
  YOUTUBE_API_KEY   required for YouTube
  RUN_MODE          "weekly" (scheduled run) or "saves" (started by a save). Default "saves".
  POOL_DIR          where the pool branch is checked out. Default .pool in the repo.

Standard library only.
"""

import gzip
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # noqa: BLE001
    PACIFIC = timezone(timedelta(hours=-8))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "games.json")
DATA = os.path.join(ROOT, "data")
HIDDEN = os.path.join(DATA, "hidden.txt")
SUBMITTED = os.path.join(DATA, "submitted.json")
PICKS = os.path.join(DATA, "picks.json")
REPULL = os.path.join(DATA, "repull.txt")
OUT = os.path.join(DATA, "stories.json")
INDEX = os.path.join(DATA, "index.json")
GAMES_DIR = os.path.join(DATA, "games")
POOL_DIR = os.environ.get("POOL_DIR") or os.path.join(ROOT, ".pool")

# ---------- settings ----------

DEEP_PAGES = 15               # first pull of a video: 15 pages of 100 top comments (15 units)
NEW_PAGES = 3                 # weekly check: at most 3 pages of newest comments (usually 1 unit)
CHECK_EVERY_DAYS = 7          # how often each game is checked
KEEP_DAYS = 28                # pool comments nobody picked are dropped after this (YouTube allows 30)
POOL_PER_VIDEO = 300          # most comments kept in the pool per video
POOL_MIN_LENGTH = 40          # shorter comments don't go in the pool
DAILY_BUDGET = 8000           # units per day this collector may use (YouTube gives 10,000)
RUN_MINUTES = 40              # stop starting new deep pulls after this long
WORKERS = 6                   # videos fetched at the same time
MAX_STORIES_PER_SONG = 60     # comments shown per song when Mohad hasn't picked
MAX_PICKS = 200               # most comments shown when Mohad has picked
WRITE_STORIES_JSON = False    # the site reads data/index.json and data/games/ since 2 Nov 2026

STEAM_PAGES = 10              # 100 reviews per page
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

KEY = os.environ.get("YOUTUBE_API_KEY", "")


# ---------- small helpers ----------

def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    if not s:
        return None
    try:
        if len(s) == 10:
            return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def days_since(s, now):
    dt = parse_iso(s)
    return (now - dt).total_seconds() / 86400 if dt else 9999


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data, indent=2):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def sound_id(s):
    """A bank sound's id: its own id, or its file name without the extension."""
    if s.get("id"):
        return s["id"]
    return os.path.splitext(os.path.basename(s.get("file") or ""))[0]


def song_sounds(game, song):
    """The game's sounds this song uses, in the bank's order, as {id, label, file}."""
    want = set(song.get("sounds") or [])
    if not want:
        return []
    out = []
    for s in game.get("sounds") or []:
        if s.get("file") and sound_id(s) in want:
            out.append({"id": sound_id(s), "label": s.get("label", ""), "file": s["file"]})
    return out


def song_moments(song):
    return song.get("moments") or ([song["moment"]] if song.get("moment") else [])


def slots_of(game):
    """Every place comments are shown: (slot key, song, scene index or None, video ids).

    Slot keys: "<game>/<song>" for a song, "<game>/<song>/<n>" for scene n (from 1)
    with its own comment videos. Same as the site's links.
    """
    out = []
    for song in game.get("songs", []):
        base = f"{game['id']}/{song['id']}"
        out.append((base, song, None, list(dict.fromkeys(song.get("commentVideos") or []))))
        for i, m in enumerate(song_moments(song)):
            vids = list(dict.fromkeys(m.get("commentVideos") or []))
            if vids:
                out.append((f"{base}/{i + 1}", song, i, vids))
    return out


def game_videos(game):
    seen = {}
    for _, _, _, vids in slots_of(game):
        for v in vids:
            seen[v] = True
    return list(seen)


def fetch_json(url, tries=3):
    """Plain GET with retries, for Steam."""
    for attempt in range(tries):
        try:
            return http_json(url)
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def http_json(url):
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


# ---------- scoring ----------

def is_junk(t):
    return any(j in t for j in JUNK) or len(TIMESTAMP.findall(t)) >= 2


def score(text, likes):
    """Rough 'is this a personal story' score. Higher is better."""
    t = text.lower()
    if len(t) < MIN_LENGTH:
        return 0.0
    if is_junk(t):
        return 0.0
    hits = sum(1 for p in STORY_PHRASES if p in t)
    if hits == 0:
        return 0.0
    length_bonus = min(len(t), 1200) / 300          # up to 4
    first_person = min(len(re.findall(r"\b(i|me|my)\b", t)), 10) / 5  # up to 2
    return hits * 2 + length_bonus + first_person + math.log10(max(likes, 0) + 1)


def pool_worthy(text):
    """Looser than score(): what's worth showing Mohad to choose from."""
    t = text.lower()
    return len(t.strip()) >= POOL_MIN_LENGTH and not is_junk(t)


def rank_key(c):
    return (c.get("score", 0), c.get("likes", 0))


def dedupe_text(items):
    """The same text posted more than once (often copied lyrics): keep the first."""
    texts, out = set(), []
    for it in items:
        t = " ".join(it["text"].split()).lower()
        if t in texts:
            continue
        texts.add(t)
        out.append(it)
    return out


def load_submitted():
    """Comments people sent through the site and Mohad approved, keyed by (game, song)."""
    data = read_json(SUBMITTED, {})
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


def load_picks():
    """Mohad's choices: {slot key: [comment ids]}. A slot that's here shows only these."""
    data = read_json(PICKS, {})
    picks = data.get("picks", data) if isinstance(data, dict) else {}
    return {k: [i for i in v if isinstance(i, str)] for k, v in picks.items() if isinstance(v, list)}


def load_repull():
    """{video id: requested time}. Format per line: VIDEOID 2026-11-03 (or a full ISO time)."""
    out = {}
    if not os.path.exists(REPULL):
        return out
    with open(REPULL, encoding="utf-8") as f:
        for ln in f:
            parts = ln.split("#")[0].split()
            if len(parts) >= 2 and parse_iso(parts[1]):
                out[parts[0]] = iso(parse_iso(parts[1]))
    return out


# ---------- YouTube ----------

class QuotaOut(Exception):
    pass


class YTError(Exception):
    def __init__(self, reason, code):
        super().__init__(f"{code} {reason}".strip())
        self.reason = reason
        self.code = code


class Quota:
    """Units used today (YouTube's day runs on Pacific time)."""

    def __init__(self, state, budget=DAILY_BUDGET):
        day = datetime.now(PACIFIC).strftime("%Y-%m-%d")
        q = state.setdefault("quota", {})
        if q.get("day") != day:
            q.clear()
            q.update(day=day, used=0)
        self.q = q
        self.budget = budget
        self.lock = threading.Lock()
        self.out = False
        self.run = 0

    def left(self):
        return self.budget - self.q["used"]

    def take(self, n=1):
        with self.lock:
            if self.out or self.q["used"] + n > self.budget:
                self.out = True
                raise QuotaOut()
            self.q["used"] += n
            self.run += n


def yt(endpoint, params, quota):
    """One YouTube Data API request (1 unit)."""
    quota.take(1)
    url = f"https://www.googleapis.com/youtube/v3/{endpoint}?" + urllib.parse.urlencode({**params, "key": KEY})
    for attempt in range(3):
        try:
            return http_json(url)
        except urllib.error.HTTPError as e:
            reason = ""
            try:
                reason = json.loads(e.read().decode("utf-8"))["error"]["errors"][0]["reason"]
            except Exception:  # noqa: BLE001
                pass
            if reason in ("quotaExceeded", "dailyLimitExceeded"):
                quota.out = True
                raise QuotaOut()
            if e.code in (400, 401, 403, 404) or attempt == 2:
                raise YTError(reason, e.code)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            if attempt == 2:
                raise YTError(str(e), 0)
        time.sleep(2 * (attempt + 1))


def thread_to_comment(item, video_id, today):
    top = item["snippet"]["topLevelComment"]
    s = top["snippet"]
    cid = top["id"]
    text = s.get("textDisplay", "").strip()
    likes = int(s.get("likeCount", 0))
    return {
        "id": f"yt:{cid}",
        "source": "youtube",
        "author": s.get("authorDisplayName", ""),
        "authorUrl": s.get("authorChannelUrl", ""),
        "text": text,
        "likes": likes,
        "date": s.get("publishedAt", "")[:10],
        "url": f"https://www.youtube.com/watch?v={video_id}&lc={cid}",
        "videoId": video_id,
        "score": round(score(text, likes), 2),
        "fetched": today,
        "seen": today,
    }, s.get("publishedAt", "")


def fetch_threads(video_id, order, pages, quota, today, stop_at=None):
    """Top-level comments of a video. With order=time, stops at comments posted at or before stop_at."""
    out, newest, token = [], "", None
    for _ in range(pages):
        params = {"part": "snippet", "videoId": video_id, "maxResults": 100,
                  "order": order, "textFormat": "plainText"}
        if token:
            params["pageToken"] = token
        data = yt("commentThreads", params, quota)
        reached = False
        for item in data.get("items", []):
            c, published = thread_to_comment(item, video_id, today)
            newest = max(newest, published)
            if stop_at and published and published <= stop_at:
                reached = True
                continue
            out.append(c)
        token = data.get("nextPageToken")
        if not token or reached:
            break
    return out, newest


def deep_pull(video_id, quota, today):
    """Top comments plus the newest page. Returns (comments, newest publish time)."""
    top, n1 = fetch_threads(video_id, "relevance", DEEP_PAGES, quota, today)
    try:
        recent, n2 = fetch_threads(video_id, "time", 1, quota, today)
    except QuotaOut:
        recent, n2 = [], ""
    return top + recent, max(n1, n2)


def refresh_comments(ids, quota):
    """Fetch comments again by id, 50 per unit. Returns {id: fields}; ids missing were deleted."""
    raw = [i[3:] for i in ids if i.startswith("yt:")]
    out = {}
    for n in range(0, len(raw), 50):
        data = yt("comments", {"part": "snippet", "id": ",".join(raw[n:n + 50]), "textFormat": "plainText"}, quota)
        for item in data.get("items", []):
            s = item.get("snippet", {})
            out[f"yt:{item['id']}"] = {
                "author": s.get("authorDisplayName", ""),
                "authorUrl": s.get("authorChannelUrl", ""),
                "text": s.get("textDisplay", "").strip(),
                "likes": int(s.get("likeCount", 0)),
            }
    return out


ISO_DURATION = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def video_durations(ids, quota):
    """Length in seconds of each YouTube video, 50 per request (1 quota unit each)."""
    out, ids = {}, sorted(set(i for i in ids if i))
    for n in range(0, len(ids), 50):
        data = yt("videos", {"part": "contentDetails", "id": ",".join(ids[n:n + 50])}, quota)
        for item in data.get("items", []):
            m = ISO_DURATION.fullmatch(item.get("contentDetails", {}).get("duration", "") or "")
            if m:
                d, h, mi, se = (int(x or 0) for x in m.groups())
                out[item["id"]] = d * 86400 + h * 3600 + mi * 60 + se
    return out


def song_length(song, durations):
    """How long the song plays on the site: its music track if it has one, else its first scene."""
    moments = song_moments(song)
    spec = song.get("audio") or (moments[0] if moments else None)
    if not spec or not spec.get("videoId"):
        return None
    start = spec.get("start") or 0
    end = spec.get("end") or durations.get(spec["videoId"])
    return max(0, int(end - start)) if end else None


# ---------- comment pool ----------

class Pool:
    """POOL_DIR/videos/<video id>.json.gz, loaded when needed."""

    def __init__(self, root):
        self.root = root
        self.dir = os.path.join(root, "videos")
        self.cache = {}
        self.dirty = set()

    def path(self, vid):
        return os.path.join(self.dir, f"{vid}.json.gz")

    def get(self, vid):
        if vid not in self.cache:
            p = self.path(vid)
            data = None
            if os.path.exists(p):
                try:
                    with gzip.open(p, "rt", encoding="utf-8") as f:
                        data = json.load(f)
                except Exception as e:  # noqa: BLE001
                    print(f"  pool {vid}: unreadable ({e}), starting again", file=sys.stderr)
            self.cache[vid] = data or {"videoId": vid, "deepAt": None, "comments": []}
        return self.cache[vid]

    def mark(self, vid):
        self.dirty.add(vid)

    def drop(self, vid):
        self.cache.pop(vid, None)
        self.dirty.discard(vid)
        if os.path.exists(self.path(vid)):
            os.remove(self.path(vid))

    def existing(self):
        if not os.path.isdir(self.dir):
            return []
        return [f[:-8] for f in os.listdir(self.dir) if f.endswith(".json.gz")]

    def save(self):
        os.makedirs(self.dir, exist_ok=True)
        for vid in sorted(self.dirty):
            data = self.cache[vid]
            raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            with open(self.path(vid), "wb") as f:
                f.write(gzip.compress(raw, mtime=0))
        self.dirty.clear()


def merge_pool(pool, vid, fresh, keep_ids, now, deep=False):
    """Add fetched comments to a video's pool, drop old unpicked ones, keep the best POOL_PER_VIDEO."""
    data = pool.get(vid)
    by = {c["id"]: c for c in data["comments"]}
    for c in fresh:
        if not pool_worthy(c["text"]) and c["id"] not in keep_ids:
            continue
        old = by.get(c["id"])
        if old:
            c["seen"] = old.get("seen", c["seen"])
        by[c["id"]] = c
    if deep:
        data["deepAt"] = iso(now)
    prune_pool(data, keep_ids, now, by)
    pool.mark(vid)


def prune_pool(data, keep_ids, now, by=None):
    """Drop pool comments older than KEEP_DAYS unless they're picked. Returns True if anything changed."""
    by = by if by is not None else {c["id"]: c for c in data["comments"]}
    # Nothing is kept past 30 days, picked or not (YouTube's rule). Picked ones are fetched
    # again every week, so they only get that old if YouTube can't be reached.
    kept = [c for c in by.values()
            if days_since(c.get("fetched"), now) <= (30 if c["id"] in keep_ids else KEEP_DAYS)]
    picked = [c for c in kept if c["id"] in keep_ids]
    rest = sorted((c for c in kept if c["id"] not in keep_ids), key=rank_key, reverse=True)
    new = picked + rest[:max(0, POOL_PER_VIDEO - len(picked))]
    new.sort(key=rank_key, reverse=True)
    changed = [c["id"] for c in new] != [c["id"] for c in data["comments"]] or len(new) != len(by)
    data["comments"] = new
    return changed


# ---------- main ----------

def load_previous(config):
    """Last run's output per game: data/games/<id>.json, or the old stories.json."""
    prev = {}
    old = read_json(OUT, {})
    old_time = (old.get("updated") or "")[:10]
    for g in old.get("games", []):
        prev[g["id"]] = g
    for game in config["games"]:
        p = os.path.join(GAMES_DIR, f"{game['id']}.json")
        if os.path.exists(p):
            prev[game["id"]] = read_json(p, {})
    # Comments from before this collector have no fetch date; use the old file's date.
    for g in prev.values():
        for s in g.get("songs", []):
            for c in s.get("stories", []):
                c.setdefault("fetched", old_time)
            for m in s.get("moments") or []:
                for c in m.get("stories") or []:
                    c.setdefault("fetched", old_time)
    return prev


def previous_slot_stories(prev_game, song, scene_index):
    for s in (prev_game or {}).get("songs", []):
        if s.get("id") != song["id"]:
            continue
        if scene_index is None:
            return s.get("stories") or []
        moments = s.get("moments") or []
        cur = song_moments(song)
        if scene_index < len(moments) and scene_index < len(cur) and moments[scene_index].get("videoId") == cur[scene_index].get("videoId"):
            return moments[scene_index].get("stories") or []
    return []


def main():
    started = time.time()
    now = now_utc()
    today = now.strftime("%Y-%m-%d")
    mode = (os.environ.get("RUN_MODE") or "saves").strip().lower()
    if mode not in ("weekly", "saves"):
        mode = "saves"

    config = read_json(CONFIG, {"games": []})
    prev_games = load_previous(config)
    hidden = load_hidden()
    submitted = load_submitted()
    picks = load_picks()
    repull = load_repull()

    pool = Pool(POOL_DIR)
    state = read_json(os.path.join(POOL_DIR, "state.json"), {})
    vstate = state.setdefault("videos", {})
    gstate = state.setdefault("games", {})
    dstate = state.setdefault("durations", {})
    quota = Quota(state)
    log = [f"mode: {mode}"]
    if not KEY:
        print("No YOUTUBE_API_KEY set, skipping YouTube.", file=sys.stderr)
        log.append("no YouTube key, nothing fetched")

    games = config.get("games", [])
    all_videos = []
    for game in games:
        for v in game_videos(game):
            if v not in all_videos:
                all_videos.append(v)

    # Comments that must never be dropped from the pool: shown on the site, or picked.
    keep_ids = set(i for ids in picks.values() for i in ids)
    for g in prev_games.values():
        for s in g.get("songs", []):
            keep_ids.update(c["id"] for c in s.get("stories", []))
            for m in s.get("moments") or []:
                keep_ids.update(c["id"] for c in m.get("stories") or [])

    changed = set()        # videos whose pool changed this run
    refreshed = {}         # comment id -> fresh fields
    deleted = set()        # comment ids YouTube no longer has
    problems = {}          # video id -> error

    def note_error(vid, err):
        vstate.setdefault(vid, {})["error"] = str(err)
        problems[vid] = str(err)
        log.append(f"{vid}: failed ({err})")

    # 1. Deep pulls: new videos, and ones asked for again in repull.txt.
    def wants_deep(vid):
        st = vstate.get(vid, {})
        if not st.get("deepAt"):
            return not st.get("error") or mode == "weekly" or vid in repull
        return vid in repull and st["deepAt"] < repull[vid]

    queue = [v for v in all_videos if wants_deep(v)]
    done_deep = 0
    if KEY and queue:
        log.append(f"deep pulls waiting: {len(queue)}")
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            pending = {}
            it = iter(queue)

            def submit_next():
                # Leave room for the pulls already running, so none is cut off halfway.
                if quota.out or time.time() - started > RUN_MINUTES * 60 \
                        or quota.left() - len(pending) * (DEEP_PAGES + 1) < DEEP_PAGES + 1:
                    return False
                vid = next(it, None)
                if vid is None:
                    return False
                pending[ex.submit(deep_pull, vid, quota, today)] = vid
                return True

            for _ in range(WORKERS):
                if not submit_next():
                    break
            while pending:
                fut = next(iter(pending))
                vid = pending.pop(fut)
                try:
                    fresh, newest = fut.result()
                    merge_pool(pool, vid, fresh, keep_ids, now, deep=True)
                    st = vstate.setdefault(vid, {})
                    st.update(deepAt=iso(now), checkedAt=iso(now))
                    st["newestAt"] = max(st.get("newestAt") or "", newest)
                    st.pop("error", None)
                    changed.add(vid)
                    done_deep += 1
                    log.append(f"{vid}: deep pull, {len(fresh)} comments, {len(pool.get(vid)['comments'])} in pool")
                except QuotaOut:
                    log.append(f"{vid}: waiting, out of quota for today")
                except YTError as e:
                    note_error(vid, e)
                except Exception as e:  # noqa: BLE001
                    note_error(vid, f"unexpected: {e}")
                submit_next()
        left = len([v for v in queue if wants_deep(v)])
        if left:
            log.append(f"deep pulls still waiting: {left}")

    # A game is ready once all its videos have had a deep pull (or failed).
    for game in games:
        gs = gstate.setdefault(game["id"], {})
        vids = game_videos(game)
        if not gs.get("checkedAt") and all(vstate.get(v, {}).get("deepAt") or vstate.get(v, {}).get("error") for v in vids):
            gs["checkedAt"] = iso(now)

    # 2. Weekly: a share of the games each run, oldest first.
    if KEY and mode == "weekly" and not quota.out:
        due = [g for g in games
               if gstate.get(g["id"], {}).get("checkedAt")
               and days_since(gstate[g["id"]]["checkedAt"], now) >= CHECK_EVERY_DAYS - 0.5]
        due.sort(key=lambda g: gstate[g["id"]]["checkedAt"])
        cap = max(1, math.ceil(len(games) / CHECK_EVERY_DAYS)) + 2
        for game in due[:cap]:
            try:
                for vid in game_videos(game):
                    st = vstate.setdefault(vid, {})
                    if not st.get("deepAt"):
                        continue
                    if days_since(st.get("checkedAt"), now) < CHECK_EVERY_DAYS - 1:
                        continue           # shared with a game checked this week
                    try:
                        fresh, newest = fetch_threads(vid, "time", NEW_PAGES, quota, today, stop_at=st.get("newestAt"))
                        merge_pool(pool, vid, fresh, keep_ids, now)
                        st["checkedAt"] = iso(now)
                        st["newestAt"] = max(st.get("newestAt") or "", newest)
                        st.pop("error", None)
                        changed.add(vid)
                        log.append(f"{vid}: {len(fresh)} new comments")
                    except YTError as e:
                        note_error(vid, e)
                # Comments shown or picked for this game, fetched again by id.
                ids = set()
                prev = prev_games.get(game["id"], {})
                for key, song, idx, _ in slots_of(game):
                    ids.update(c["id"] for c in previous_slot_stories(prev, song, idx))
                    ids.update(picks.get(key, []))
                ids = sorted(i for i in ids if i.startswith("yt:"))
                try:
                    got = refresh_comments(ids, quota)
                except YTError as e:
                    log.append(f"{game['id']}: refresh failed ({e}), trying again next run")
                    continue
                refreshed.update(got)
                gone = set(ids) - set(got)
                deleted.update(gone)
                gstate.setdefault(game["id"], {})["checkedAt"] = iso(now)
                log.append(f"{game['id']}: checked, {len(got)} comments refreshed, {len(gone)} gone")
            except QuotaOut:
                log.append(f"{game['id']}: waiting, out of quota for today")
                break

    # Apply refreshes and deletions to the pool too.
    if refreshed or deleted:
        for vid in all_videos:
            if not os.path.exists(pool.path(vid)) and vid not in pool.cache:
                continue
            data = pool.get(vid)
            hit = False
            for c in data["comments"]:
                if c["id"] in refreshed:
                    c.update(refreshed[c["id"]], fetched=today)
                    c["score"] = round(score(c["text"], c["likes"]), 2)
                    hit = True
            before = len(data["comments"])
            data["comments"] = [c for c in data["comments"] if c["id"] not in deleted]
            if hit or len(data["comments"]) != before:
                pool.mark(vid)

    # 3. Video lengths, cached for a week.
    if KEY and not quota.out:
        ids = []
        for game in games:
            for song in game.get("songs", []):
                for m in song_moments(song):
                    ids.append(m.get("videoId"))
                    if m.get("audio"):
                        ids.append(m["audio"].get("videoId"))
                if song.get("audio"):
                    ids.append(song["audio"].get("videoId"))
        stale = sorted({i for i in ids if i and (i not in dstate or (mode == "weekly" and days_since(dstate[i][1], now) >= CHECK_EVERY_DAYS))})
        if stale:
            try:
                got = video_durations(stale, quota)
                for i in stale:
                    if i in got:
                        dstate[i] = [got[i], iso(now)]
                log.append(f"lengths: {len(got)} videos")
            except (QuotaOut, YTError) as e:
                log.append(f"lengths: failed ({e or 'out of quota'})")
    durations = {k: v[0] for k, v in dstate.items()}

    # 4. Tidy the pool: drop videos no longer used and old unpicked comments.
    used = set(all_videos)
    for vid in pool.existing():
        if vid not in used:
            pool.drop(vid)
            vstate.pop(vid, None)
    for vid in list(vstate):
        if vid not in used:
            vstate.pop(vid)
    if mode == "weekly":
        for vid in pool.existing():
            if vid in pool.dirty:
                continue
            data = pool.get(vid)
            if prune_pool(data, keep_ids, now):
                pool.mark(vid)
            else:
                pool.cache.pop(vid, None)   # keep memory down

    # 5. Build the output.
    games_out, index_games = [], []
    for game in games:
        prev = prev_games.get(game["id"], {})
        songs_out = []
        slot_stories = {}
        for key, song, idx, vids in slots_of(game):
            vset = set(vids)
            cands = {}
            for c in previous_slot_stories(prev, song, idx):
                if c.get("source") != "youtube" or c.get("videoId") not in vset or c["id"] in deleted:
                    continue
                c = dict(c)
                if c["id"] in refreshed:
                    c.update(refreshed[c["id"]], fetched=today)
                c["score"] = round(score(c["text"], c["likes"]), 2)
                cands[c["id"]] = c
            manual = picks.get(key)
            need_pool = (any(v in changed for v in vids)
                         or (manual is not None and any(i not in cands for i in manual))
                         or (manual is None and any(i in hidden for i in cands)))
            if need_pool:
                for v in vids:
                    for c in pool.get(v)["comments"]:
                        old = cands.get(c["id"])
                        if c["id"] in deleted or (old and (old.get("fetched") or "") > (c.get("fetched") or "")):
                            continue
                        cands[c["id"]] = dict(c)
            fresh = [c for c in cands.values()
                     if c["id"] not in hidden and days_since(c.get("fetched"), now) <= 30]
            if manual is not None:
                order = {i: n for n, i in enumerate(manual)}
                chosen = sorted((c for c in fresh if c["id"] in order), key=rank_key, reverse=True)[:MAX_PICKS]
            else:
                good = sorted((c for c in fresh if c.get("score", 0) >= MIN_SCORE), key=rank_key, reverse=True)
                chosen = dedupe_text(good)[:MAX_STORIES_PER_SONG]
            for c in chosen:
                c.pop("seen", None)
            slot_stories[key] = chosen

        for song in game.get("songs", []):
            base = f"{game['id']}/{song['id']}"
            stories = slot_stories.get(base, [])
            own = [c for c in submitted.get((game["id"], song["id"]), []) if c["id"] not in hidden]
            own_ids = {c["id"] for c in own}
            stories = own + [x for x in stories if x["id"] not in own_ids]
            moments = [dict(m) for m in song_moments(song)]
            for i, m in enumerate(moments):
                m.pop("stories", None)
                if m.get("commentVideos"):
                    m["stories"] = slot_stories.get(f"{base}/{i + 1}", [])
            prev_song = next((s for s in prev.get("songs", []) if s.get("id") == song["id"]), {})
            songs_out.append({
                "id": song["id"],
                "title": song["title"],
                "composer": song.get("composer", ""),
                "volume": song.get("volume"),
                "fadeIn": song.get("fadeIn"),
                "fadeOut": song.get("fadeOut"),
                "length": song_length(song, durations) or prev_song.get("length"),
                "moment": song.get("moment") or ({k: v for k, v in moments[0].items() if k not in ("stories", "commentVideos", "audio")} if moments else None),
                "moments": moments,
                "audio": song.get("audio"),
                "sounds": song_sounds(game, song),
                "stories": stories,
            })

        steam = []
        if STEAM_ENABLED and game.get("steamAppId"):
            try:
                raw = steam_reviews(game["steamAppId"])
                log.append(f"{game['id']}/steam: {len(raw)} reviews fetched")
                steam = pick(raw, hidden, MAX_STORIES_PER_GAME)
            except Exception as e:  # noqa: BLE001
                log.append(f"{game['id']}/steam: failed ({e})")
                steam = [s for s in prev.get("stories", []) if s["id"] not in hidden]

        g_out = {
            "id": game["id"],
            "title": game["title"],
            "year": game.get("year"),
            "cover": game.get("cover"),
            "intro": game.get("intro"),
            "sounds": game.get("sounds") or [],
            "steamAppId": game.get("steamAppId"),
            "songs": songs_out,
            "stories": steam,
        }
        games_out.append(g_out)
        index_games.append({
            "id": game["id"],
            "title": game["title"],
            "year": game.get("year"),
            "cover": game.get("cover"),
            "intro": game.get("intro"),
            "songs": [{"id": s["id"], "title": s["title"], "composer": s["composer"]} for s in songs_out],
        })

    # 6. Write everything.
    waiting = [v for v in all_videos if not vstate.get(v, {}).get("deepAt") and not vstate.get(v, {}).get("error")]
    status = {
        "mode": mode,
        "quotaDay": quota.q["day"],
        "quotaUsedToday": quota.q["used"],
        "quotaUsedThisRun": quota.run,
        "budget": DAILY_BUDGET,
        "deepPullsDone": done_deep,
        "deepPullsWaiting": len(waiting),
        "problems": [
            {"videoId": v, "error": vstate[v]["error"],
             "where": [k for g in games for k, _, _, vids in slots_of(g) if v in vids]}
            for v in all_videos if vstate.get(v, {}).get("error")
        ],
    }
    log.append(f"quota: {quota.run} units this run, {quota.q['used']} of {DAILY_BUDGET} today")
    stamp = iso(now)
    settings = config.get("settings") or {}

    os.makedirs(GAMES_DIR, exist_ok=True)
    keep_files = set()
    for g in games_out:
        write_json(os.path.join(GAMES_DIR, f"{g['id']}.json"), g, indent=1)
        keep_files.add(f"{g['id']}.json")
    for f in os.listdir(GAMES_DIR):
        if f.endswith(".json") and f not in keep_files:
            os.remove(os.path.join(GAMES_DIR, f))
    write_json(INDEX, {"updated": stamp, "settings": settings, "games": index_games, "status": status, "log": log})
    if WRITE_STORIES_JSON:
        write_json(OUT, {"updated": stamp, "settings": settings, "games": games_out, "log": log})

    pool.save()
    state["updated"] = stamp
    write_json(os.path.join(POOL_DIR, "state.json"), state)

    total = sum(len(s["stories"]) for g in games_out for s in g["songs"])
    print("\n".join(log))
    print(f"Wrote {total} song comments for {len(games_out)} games")


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
    """Score, filter and dedupe Steam reviews."""
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
    return dedupe_text(keep)[:limit]


if __name__ == "__main__":
    main()
