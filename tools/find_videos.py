"""Finds YouTube videos for the bulk chat (Claude can't reach YouTube itself).

Reads tools/find-request.json:
  { "jobs": [
      { "name": "ffx-ost", "playlist": "PL..." },
      { "name": "kh1-search", "search": "Kingdom Hearts original soundtrack", "type": "playlist", "max": 10 }
  ] }
Writes tools/found/<name>.json for each job, with each video's title, channel,
length, views, comments, and whether it can be embedded or is made for kids.

Quota: playlist pages and video details cost 1 unit per 50 videos. A search
costs 100, so MAX_SEARCHES caps them per run.
"""
import json, os, re, sys, urllib.parse, urllib.request

KEY = os.environ["YOUTUBE_API_KEY"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ = os.path.join(ROOT, "tools", "find-request.json")
OUT = os.path.join(ROOT, "tools", "found")
MAX_SEARCHES = 15
used = {"units": 0, "searches": 0}


def api(path, **params):
    params["key"] = KEY
    url = "https://www.googleapis.com/youtube/v3/" + path + "?" + urllib.parse.urlencode(params)
    used["units"] += 100 if path == "search" else 1
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def seconds(d):
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return None
    dd, h, mi, s = (int(x or 0) for x in m.groups())
    return dd * 86400 + h * 3600 + mi * 60 + s


def details(ids):
    out = {}
    for i in range(0, len(ids), 50):
        r = api("videos", part="snippet,contentDetails,statistics,status", id=",".join(ids[i:i + 50]), maxResults=50)
        for v in r.get("items", []):
            st = v.get("statistics", {})
            out[v["id"]] = {
                "id": v["id"],
                "title": v["snippet"]["title"],
                "channel": v["snippet"]["channelTitle"],
                "length": seconds(v["contentDetails"].get("duration")),
                "views": int(st.get("viewCount", 0)),
                "comments": int(st["commentCount"]) if "commentCount" in st else None,
                "embeddable": v.get("status", {}).get("embeddable"),
                "kids": v.get("status", {}).get("madeForKids"),
            }
    return out


def playlist(pid):
    info = api("playlists", part="snippet,contentDetails", id=pid).get("items", [])
    ids, token = [], None
    while True:
        p = {"part": "contentDetails", "playlistId": pid, "maxResults": 50}
        if token:
            p["pageToken"] = token
        r = api("playlistItems", **p)
        ids += [it["contentDetails"]["videoId"] for it in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    d = details(ids)
    return {
        "playlist": pid,
        "title": info[0]["snippet"]["title"] if info else None,
        "channel": info[0]["snippet"]["channelTitle"] if info else None,
        "videos": [d.get(i, {"id": i, "missing": True}) for i in ids],
    }


def search(q, kind, n):
    if used["searches"] >= MAX_SEARCHES:
        return {"error": "search limit for this run"}
    used["searches"] += 1
    r = api("search", part="snippet", q=q, type=kind, maxResults=min(n, 50))
    items = r.get("items", [])
    if kind == "video":
        d = details([it["id"]["videoId"] for it in items])
        return {"search": q, "videos": [d[i] for i in d]}
    out = []
    for it in items:
        pid = it["id"]["playlistId"]
        c = api("playlists", part="contentDetails", id=pid).get("items", [])
        out.append({"playlist": pid, "title": it["snippet"]["title"], "channel": it["snippet"]["channelTitle"],
                    "count": c[0]["contentDetails"]["itemCount"] if c else None})
    return {"search": q, "playlists": out}


def main():
    jobs = json.load(open(REQ, encoding="utf-8"))["jobs"]
    os.makedirs(OUT, exist_ok=True)
    for j in jobs:
        try:
            if "playlist" in j:
                res = playlist(j["playlist"])
            else:
                res = search(j["search"], j.get("type", "video"), j.get("max", 25))
        except Exception as e:
            res = {"error": str(e)[:300]}
        res["job"] = j
        with open(os.path.join(OUT, j["name"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
        print(j["name"], "done", "error" in res and res["error"] or "")
    print("units used:", used["units"])


main()
