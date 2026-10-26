#!/usr/bin/env python3
"""Serve one folder over loopback and collect what the review layer sends back.

Python 3 standard library only. Binds 127.0.0.1, and with --tailnet also this machine's
Tailscale IPv4, so a phone or an iPad on the same tailnet can open the prototype. It never
binds 0.0.0.0.

    GET  /api/review/memory   -> loads durable candidate memory for one project
    POST /api/review/memory   -> appends one candidate verdict to ~/.impeccable/taste/
    POST /api/review          -> appends a pin or Go; Go also enters the taste directory
    POST /api/review/asset    -> writes one attached picture under <folder>/reviews/assets/

The page opts in by setting window.REVIEW_ENDPOINT = '/api/review' before review-layer.js.
Without a server the layer still works; the pins then live in localStorage and come out
through Export.

    python3 review-serve.py <folder> --port 8795 [--tailnet]
"""

import argparse
import base64
import functools
import json
import re
import socketserver
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MAX_BODY = 4 * 1024 * 1024
MAX_IMAGE = 3 * 1024 * 1024
TAILSCALE = Path("/Applications/Tailscale.app/Contents/MacOS/Tailscale")
ROOT = Path.cwd()
TASTE_DIR = Path.home() / ".impeccable" / "taste"
REVIEW_VERDICTS = TASTE_DIR / "review-verdicts.jsonl"
REVIEW_ROUNDS = TASTE_DIR / "review-rounds.jsonl"
STORE_VERSION = 1
REVIEW_OUTCOMES = frozenset(("love", "like", "no"))


def page_slug(value):
    """One filesystem-safe name per reviewed page, derived from its path."""
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-") or "index"


GO_FIELDS = frozenset((
    "notes",
    "tokens",
    "faces",
    "candidates",
    "chosen",
    "unresolved",
    "about",
    "aboutPage",
    "tokenOverrides",
    "overrides",
    "verdicts",
    "chosenCandidate",
    "sizes",
    "themes",
))
REVIEW_LOCK = threading.Lock()
TASTE_LOCK = threading.Lock()


def read_jsonl(target):
    """Read valid object lines and skip a truncated or corrupt append."""
    try:
        lines = target.read_text("utf-8").splitlines()
    except OSError:
        return []
    records = []
    for line in lines:
        try:
            record = json.loads(line)
        except (TypeError, ValueError):
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


def append_jsonl(target, record):
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def append_review_verdict(payload):
    """Append one unary island judgement in the taste ledger's JSONL convention."""
    project = str(payload.get("project") or "").strip() if isinstance(payload, dict) else ""
    candidate = payload.get("candidate") if isinstance(payload, dict) else None
    verdict = payload.get("verdict") if isinstance(payload, dict) else None
    valid = (
        project
        and isinstance(candidate, dict)
        and candidate.get("id")
        and isinstance(verdict, dict)
        and verdict.get("candidateId") == candidate.get("id")
        and verdict.get("verdict") in REVIEW_OUTCOMES
    )
    if not valid:
        return False
    with TASTE_LOCK:
        append_jsonl(REVIEW_VERDICTS, {
            "v": STORE_VERSION,
            "project": project,
            "candidate": candidate,
            "verdict": verdict,
        })
    return True


def append_review_round(project, record):
    """Append one complete Go bundle adjacent to the verdict stream."""
    project = str(project or "").strip()
    if not project or not isinstance(record, dict):
        return False
    with TASTE_LOCK:
        append_jsonl(REVIEW_ROUNDS, {
            "v": STORE_VERSION,
            "project": project,
            "at": record.get("at"),
            "record": record,
        })
    return True


def read_project_memory(project):
    """Return the newest durable judgement per candidate for one project."""
    project = str(project or "").strip()
    latest = {}
    for row in read_jsonl(REVIEW_VERDICTS):
        if row.get("project") != project:
            continue
        candidate = row.get("candidate")
        verdict = row.get("verdict")
        candidate_id = candidate.get("id") if isinstance(candidate, dict) else None
        if not candidate_id or not isinstance(verdict, dict):
            continue
        prior = latest.get(candidate_id)
        if prior is None or str(verdict.get("at") or "") >= str(prior["verdict"].get("at") or ""):
            latest[candidate_id] = {"candidate": candidate, "verdict": verdict}
    ordered = sorted(latest.values(), key=lambda item: str(item["verdict"].get("at") or ""))
    candidates = []
    verdicts = []
    for item in ordered:
        candidate = dict(item["candidate"])
        verdict = dict(item["verdict"])
        candidate["verdict"] = verdict.get("verdict")
        candidate["at"] = verdict.get("at")
        candidates.append(candidate)
        verdicts.append(verdict)
    return {"project": project, "candidates": candidates, "verdicts": verdicts}


def is_go_record(record):
    """Tell a Go bundle from the legacy single-pin protocol.

    A pin can carry arbitrary prose, so use the fields that only make sense as
    page-level judgement. This deliberately does not require all fields: an
    empty round still needs to preserve the sizes and themes it inspected.
    """
    return bool(GO_FIELDS.intersection(record))


def reviewer_identity(record):
    """Compare reviewer identities without rewriting the submitted value.

    Missing, null, and empty reviewers are the one legacy anonymous reviewer.
    Every non-empty value remains distinct, including values that merely look
    alike after case-folding or whitespace cleanup. The server is storage, not
    an identity authority.
    """
    value = record.get("reviewer")
    if value is None or value == "":
        return "anonymous"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def same_legacy_pin(record, existing):
    return (
        isinstance(existing, dict)
        and not is_go_record(existing)
        and existing.get("id")
        and existing.get("id") == record.get("id")
        and reviewer_identity(existing) == reviewer_identity(record)
    )


def read_review_entries(target):
    """Read both the original JSON array and a future explicit record wrapper."""
    if not target.exists():
        return [], "list"
    try:
        loaded = json.loads(target.read_text("utf-8"))
    except (OSError, ValueError):
        return [], "list"
    if isinstance(loaded, list):
        return loaded, "list"
    if isinstance(loaded, dict):
        for key in ("records", "pins"):
            if isinstance(loaded.get(key), list):
                return loaded[key], key
    return [], "list"


def write_review_entries(target, entries, container):
    """Preserve a legacy array on disk while keeping wrapper files readable."""
    payload = entries if container == "list" else {container: entries}
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", "utf-8")


class Handler(SimpleHTTPRequestHandler):
    def reply(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        return body if isinstance(body, dict) else None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path or "")
        if parsed.path == "/api/review/memory":
            project = parse_qs(parsed.query).get("project", [""])[0]
            if not project:
                return self.reply(400, {"error": "project is required"})
            return self.reply(200, read_project_memory(project))
        return super().do_GET()

    def do_POST(self):
        route = urlparse(self.path or "").path
        if route == "/api/review":
            return self.api_review()
        if route == "/api/review/memory":
            return self.api_memory()
        if route == "/api/review/asset":
            return self.api_asset()
        return self.reply(404, {"error": "no such route"})

    def api_memory(self):
        record = self.read_json()
        if record is None or not append_review_verdict(record):
            return self.reply(400, {"error": "the body must be one valid project candidate verdict"})
        return self.reply(200, {"saved": True, "project": record.get("project")})

    def api_review(self):
        record = self.read_json()
        if record is None:
            return self.reply(400, {"error": "the body must be one JSON review object"})
        target = ROOT / "reviews" / ("%s.json" % page_slug(record.get("page")))
        target.parent.mkdir(parents=True, exist_ok=True)
        with REVIEW_LOCK:
            entries, container = read_review_entries(target)

            if is_go_record(record):
                # A Go is one dated proposal. It must stay whole: splitting it
                # severs notes from token/face diffs, candidates, and conditions.
                entries.append(record)
                kind = "record"
            else:
                # Keep the v1 protocol byte-for-byte in spirit: one pin replaces
                # the prior pin with the same id for the same reviewer.
                entries = [
                    entry for entry in entries
                    if not same_legacy_pin(record, entry)
                ]
                entries.append(record)
                kind = "pin"

            write_review_entries(target, entries, container)
        print("  %s %s -> reviews/%s" % (kind, record.get("id") or record.get("recordId") or "Go", target.name))
        project = parse_qs(urlparse(self.path or "").query).get("project", [""])[0]
        durable_saved = append_review_round(project, record) if kind == "record" and project else False
        return self.reply(200, {
            "saved": True,
            "durableSaved": durable_saved,
            "count": len(entries),
            "file": "reviews/%s" % target.name,
        })

    def api_asset(self):
        body = self.read_json()
        if body is None:
            return self.reply(400, {"error": "the body must be one JSON asset object"})
        match = re.match(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$", str(body.get("image") or ""))
        if not match:
            return self.reply(400, {"error": "the image must be a PNG or JPEG data URL"})
        try:
            image = base64.b64decode(match.group(2), validate=True)
        except (ValueError, base64.binascii.Error):
            return self.reply(400, {"error": "the image data is not valid base64"})
        ext = "png" if match.group(1) == "png" else "jpg"
        signed = image.startswith(b"\x89PNG\r\n\x1a\n") if ext == "png" else image.startswith(b"\xff\xd8\xff")
        if not signed or len(image) > MAX_IMAGE:
            return self.reply(400, {"error": "the image is invalid or too large"})
        pin_id = re.sub(r"[^A-Za-z0-9_-]", "", str(body.get("pinId") or ""))[:80] or "pin"
        assets = ROOT / "reviews" / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        name = "%s-%s.%s" % (page_slug(body.get("page")), pin_id, ext)
        (assets / name).write_bytes(image)
        print("  picture -> reviews/assets/%s (%d bytes)" % (name, len(image)))
        return self.reply(200, {"saved": True, "path": "/reviews/assets/%s" % name, "bytes": len(image)})


def tailnet_address():
    if not TAILSCALE.exists():
        print("  Tailscale is not installed here, so only 127.0.0.1 is served.")
        return None
    try:
        out = subprocess.run([str(TAILSCALE), "ip", "-4"], capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.SubprocessError):
        print("  Tailscale did not answer, so only 127.0.0.1 is served.")
        return None
    address = (out.stdout or "").strip().splitlines()
    address = address[0].strip() if address else ""
    if not re.match(r"^\d{1,3}(\.\d{1,3}){3}$", address):
        print("  Tailscale gave no address, so only 127.0.0.1 is served.")
        return None
    return address


def main():
    global ROOT
    ap = argparse.ArgumentParser(
        prog="review-serve.py",
        description="Serve a prototype folder, write page reviews under <folder>/reviews/, and keep project candidate memory under ~/.impeccable/taste/.",
    )
    ap.add_argument("folder", nargs="?", default=".", type=Path, help="folder to serve (default: the current one)")
    ap.add_argument("--port", type=int, default=8795, help="port to listen on (default 8795)")
    ap.add_argument("--tailnet", action="store_true",
                    help="also listen on this machine's Tailscale IPv4, for the phone and the iPad")
    args = ap.parse_args()
    ROOT = args.folder.resolve()
    if not ROOT.is_dir():
        raise SystemExit("No such folder: %s" % ROOT)

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=str(ROOT))
    servers = [ThreadingHTTPServer(("127.0.0.1", args.port), handler)]
    urls = ["http://127.0.0.1:%d/" % args.port]
    if args.tailnet:
        address = tailnet_address()
        if address:
            try:
                servers.append(ThreadingHTTPServer((address, args.port), handler))
                urls.append("http://%s:%d/" % (address, args.port))
            except OSError as err:
                print("  Could not listen on %s (%s); loopback only." % (address, err))

    print("Review server - %s - serving %s - page reviews in %s - project memory in %s" % (" and ".join(urls), ROOT, ROOT / "reviews", TASTE_DIR))
    for extra in servers[1:]:
        extra.daemon_threads = True
        threading.Thread(target=extra.serve_forever, daemon=True).start()
    servers[0].daemon_threads = True
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        for s in servers:
            s.server_close()


if __name__ == "__main__":
    main()
