"""A minimal local box-labelling tool. No account, no upload, no cloud.

    python training/label_tool.py                 # label the seed set
    python training/label_tool.py --dir training/data/prelabelled --review

Opens a page at http://localhost:8765. One image at a time: drag a box, press
1/2/3 to set its class, arrow keys to move on. Everything is written straight to
disk as YOLO label files, so the output drops into propagate_labels.py and the
training run without a hosted dataset in between.

Three states an image can be in, and the distinction matters:

* **labelled**  -- has one or more boxes.
* **negative**  -- reviewed, and genuinely has no defect. It is *kept*, with an
  empty label file. A YOLO training set uses these as background examples, and
  they are the cheapest way to stop a model firing on clean belt. Skipping such
  an image throws that signal away.
* **excluded**  -- not wanted in the dataset at all, e.g. shot from an angle the
  deployed camera will never see. Not copied to the output.

Suggestions are pre-filled by a crude brightness heuristic: on this rig a defect
is background showing through black rubber, so it reads as a bright blob
surrounded by dark. It is roughly half-right, which is useful only because
deleting a wrong box costs one keystroke while drawing a missing one costs
several. Treat every suggestion as a guess.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
DEFAULT_DIR = ROOT / "data" / "rig_frames"
DEFAULT_OUT = ROOT / "data" / "labelled"

# Order defines the class indices written to the label files, and must match
# the names list in the emitted data.yaml.
CLASSES = ["tear", "hole", "joint_damage"]


# --------------------------------------------------------------------------
# suggestions

def suggest(path: Path) -> list[dict]:
    """Guess defect boxes: bright blobs sitting in dark surroundings.

    Masking the belt first does not work -- it is lit from above, so any global
    threshold cuts it in half. Judging each blob by its own neighbourhood is
    immune to that, and it rejects bright clutter on the white table, whose
    surroundings are also bright.
    """
    image = cv2.imread(str(path))
    if image is None:
        return []
    # Boxes are normalised, so the heuristic can run on a downscaled copy. At
    # full resolution 361 stills take minutes; this keeps startup near-instant.
    scale = 1200 / max(image.shape[:2])
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale,
                           interpolation=cv2.INTER_AREA)
    grey = cv2.GaussianBlur(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    h, w = grey.shape
    _, bright = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(bright, 8)

    out: list[dict] = []
    for i in range(1, count):
        x, y, bw, bh, area = (int(v) for v in stats[i, :5])
        if not (h * w * 0.0002 <= area <= h * w * 0.05):
            continue
        if x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1:
            continue                      # defects are interior to the belt
        blob = (labels == i).astype(np.uint8)
        ring = cv2.dilate(blob, np.ones((41, 41), np.uint8)) - blob
        around = grey[ring > 0]
        if around.size < 50:
            continue
        inside = float(np.median(grey[blob > 0]))
        outside = float(np.median(around))
        if inside - outside < 45 or float((around < inside - 40).mean()) < 0.5:
            continue
        # Elongated reads as a tear, compact as a hole. Wrong often enough that
        # it is a starting point, not an answer -- 1/2/3 reclassifies.
        elongated = max(bw, bh) / max(1, min(bw, bh)) >= 2.5
        out.append({
            "cls": 0 if elongated else 1,
            "x": (x + bw / 2) / w, "y": (y + bh / 2) / h,
            "w": bw / w, "h": bh / h,
        })
    return out


# --------------------------------------------------------------------------
# state

class Store:
    def __init__(self, src: Path, out: Path, review: bool) -> None:
        self.src = src
        self.out = out
        self.review = review
        self.state_file = out / "state.json"
        out.mkdir(parents=True, exist_ok=True)

        self.names = sorted(p.name for p in src.glob("*.jpg"))
        if not self.names:
            sys.exit(f"No .jpg images in {src}")

        self.state: dict[str, dict] = {}
        if self.state_file.exists():
            self.state = json.loads(self.state_file.read_text())

        fresh = [n for n in self.names if n not in self.state]
        if fresh:
            print(f"  preparing suggestions for {len(fresh)} images…", flush=True)
        for i, name in enumerate(fresh, 1):
            if i % 50 == 0:
                print(f"    {i}/{len(fresh)}", flush=True)
            boxes = self._existing(name)
            self.state[name] = {
                "boxes": boxes if boxes is not None else suggest(src / name),
                "status": "todo",
                "suggested": boxes is None,
            }
        if fresh:
            self.save()

    def _existing(self, name: str) -> list[dict] | None:
        """Read boxes already on disk (a propagate run, or a previous session)."""
        for folder in (self.src / "labels", self.src.parent / "labels",
                       self.src / ".." / "train" / "labels"):
            txt = Path(folder) / f"{Path(name).stem}.txt"
            if txt.exists():
                boxes = []
                for line in txt.read_text().splitlines():
                    parts = line.split()
                    if len(parts) >= 5:
                        boxes.append({"cls": int(parts[0]), "x": float(parts[1]),
                                      "y": float(parts[2]), "w": float(parts[3]),
                                      "h": float(parts[4])})
                return boxes
        return None

    def save(self) -> None:
        self.state_file.write_text(json.dumps(self.state, indent=1))

    def export(self) -> dict:
        """Write a YOLO dataset of everything reviewed and not excluded."""
        images = self.out / "train" / "images"
        labels = self.out / "train" / "labels"
        for folder in (images, labels):
            if folder.exists():
                shutil.rmtree(folder)
            folder.mkdir(parents=True)

        counts = {c: 0 for c in CLASSES}
        kept = negatives = excluded = todo = 0
        for name, item in self.state.items():
            if item["status"] == "excluded":
                excluded += 1
                continue
            if item["status"] == "todo":
                todo += 1
                continue
            shutil.copy2(self.src / name, images / name)
            lines = []
            for b in item["boxes"]:
                lines.append(f"{int(b['cls'])} {b['x']:.6f} {b['y']:.6f} "
                             f"{b['w']:.6f} {b['h']:.6f}")
                if 0 <= int(b["cls"]) < len(CLASSES):
                    counts[CLASSES[int(b["cls"])]] += 1
            (labels / f"{Path(name).stem}.txt").write_text(
                "\n".join(lines) + ("\n" if lines else ""))
            kept += 1
            negatives += not lines

        # Absolute path: Ultralytics resolves a relative `path:` against the
        # working directory, not against the yaml, so "." silently points at
        # wherever the training command happened to be run from.
        (self.out / "data.yaml").write_text(
            f"path: {self.out.resolve()}\ntrain: train/images\nval: train/images\n"
            f"nc: {len(CLASSES)}\nnames:\n"
            + "".join(f"  - {c}\n" for c in CLASSES))
        self.save()
        return {"kept": kept, "negatives": negatives, "excluded": excluded,
                "todo": todo, "counts": counts, "out": str(self.out)}


# --------------------------------------------------------------------------
# server

def make_handler(store: Store):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):      # keep the console readable
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            route = urlparse(self.path).path
            if route == "/":
                return self._send(200, PAGE, "text/html; charset=utf-8")
            if route == "/api/items":
                return self._send(200, json.dumps({
                    "classes": CLASSES,
                    "items": [{"name": n, **store.state[n]} for n in store.names],
                }))
            if route.startswith("/img/"):
                name = unquote(route[len("/img/"):])
                path = store.src / name
                if not path.exists():
                    return self._send(404, b"", "text/plain")
                return self._send(200, path.read_bytes(), "image/jpeg")
            return self._send(404, b"", "text/plain")

        def do_POST(self):
            route = urlparse(self.path).path
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")

            if route == "/api/save":
                name = payload.get("name")
                if name in store.state:
                    store.state[name] = {
                        "boxes": payload.get("boxes", []),
                        "status": payload.get("status", "todo"),
                        "suggested": False,
                    }
                    store.save()
                return self._send(200, json.dumps({"ok": True}))

            if route == "/api/finish":
                report = store.export()
                print("\n" + "=" * 62)
                print(f"  kept       {report['kept']}  "
                      f"(of which {report['negatives']} negative)")
                print(f"  excluded   {report['excluded']}")
                print(f"  not done   {report['todo']}")
                for cls, n in report["counts"].items():
                    print(f"    {cls:14} {n} boxes")
                print(f"\n  -> {report['out']}")
                print("=" * 62)
                return self._send(200, json.dumps(report))

            return self._send(404, b"", "text/plain")

    return Handler


PAGE = r"""<!doctype html>
<meta charset="utf-8"><title>Label</title>
<style>
:root{--bg:#101114;--panel:#181a1f;--line:#2a2d34;--ink:#e8eaed;--dim:#9aa0a8;
      --tear:#ff6b6b;--hole:#4dabf7;--joint:#ffd43b;--ok:#51cf66}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  display:flex;height:100vh;overflow:hidden}
#stage{flex:1;display:flex;align-items:center;justify-content:center;
  position:relative;padding:16px;min-width:0}
canvas{max-width:100%;max-height:100%;cursor:crosshair;
  box-shadow:0 8px 40px rgba(0,0,0,.6);border-radius:4px}
aside{width:290px;flex:none;background:var(--panel);border-left:1px solid var(--line);
  padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:18px}
h1{font-size:15px;margin:0;letter-spacing:.02em}
.muted{color:var(--dim);font-size:12.5px}
.bar{height:5px;background:var(--line);border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--ok);transition:width .2s}
.cls{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:6px;
  border:1px solid transparent;cursor:pointer;user-select:none}
.cls.on{border-color:currentColor;background:rgba(255,255,255,.05)}
.dot{width:11px;height:11px;border-radius:3px;background:currentColor;flex:none}
kbd{background:#23262d;border:1px solid var(--line);border-bottom-width:2px;
  border-radius:4px;padding:1px 6px;font:12px ui-monospace,monospace;color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
td{padding:3px 0;color:var(--dim)} td:last-child{text-align:right;color:var(--ink)}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;
  font-weight:600;letter-spacing:.03em}
.todo{background:#3a3f47;color:#c3c9d1}
.done{background:rgba(81,207,102,.18);color:var(--ok)}
.negative{background:rgba(77,171,247,.18);color:var(--hole)}
.excluded{background:rgba(255,107,107,.18);color:var(--tear)}
button{width:100%;padding:10px;border-radius:6px;border:1px solid var(--line);
  background:#23262d;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#2b2f37} button.go{background:var(--ok);color:#06210d;border:0}
</style>
<div id="stage"><canvas id="c"></canvas></div>
<aside>
  <div>
    <h1 id="fname">—</h1>
    <div class="muted" id="pos"></div>
  </div>
  <div class="bar"><i id="prog" style="width:0"></i></div>
  <div id="status"></div>

  <div>
    <div class="muted" style="margin-bottom:7px">Class for new boxes</div>
    <div id="classes"></div>
  </div>

  <div>
    <div class="muted" style="margin-bottom:7px">Boxes on this image</div>
    <div id="boxes" class="muted">none</div>
  </div>

  <table>
    <tr><td>drag</td><td>draw a box</td></tr>
    <tr><td>click box</td><td>select</td></tr>
    <tr><td><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></td><td>set class</td></tr>
    <tr><td><kbd>⌫</kbd></td><td>delete selected</td></tr>
    <tr><td><kbd>A</kbd></td><td>accept as-is</td></tr>
    <tr><td><kbd>N</kbd></td><td>no defects (keep)</td></tr>
    <tr><td><kbd>X</kbd></td><td>exclude image</td></tr>
    <tr><td><kbd>←</kbd><kbd>→</kbd></td><td>prev / next</td></tr>
  </table>

  <div style="margin-top:auto;display:flex;flex-direction:column;gap:9px">
    <button id="finish" class="go">Finish &amp; export</button>
    <div class="muted" id="done" style="text-align:center"></div>
  </div>
</aside>
<script>
const COLORS=['#ff6b6b','#4dabf7','#ffd43b'];
let items=[],classes=[],idx=0,cur=0,sel=-1,img=new Image(),drag=null;
const c=document.getElementById('c'),ctx=c.getContext('2d');

const it=()=>items[idx];

async function boot(){
  const r=await(await fetch('/api/items')).json();
  classes=r.classes; items=r.items;
  document.getElementById('classes').innerHTML=classes.map((n,i)=>
    `<div class="cls" data-i="${i}" style="color:${COLORS[i]}">
       <span class="dot"></span><span style="color:var(--ink)">${n}</span>
       <kbd style="margin-left:auto">${i+1}</kbd></div>`).join('');
  document.querySelectorAll('.cls').forEach(el=>el.onclick=()=>setCls(+el.dataset.i));
  idx=Math.max(0,items.findIndex(x=>x.status==='todo'));
  if(idx<0)idx=0;
  load();
}

function load(){
  sel=-1; img=new Image();
  img.onload=()=>{fit();draw();};
  img.src='/img/'+encodeURIComponent(it().name);
  paint();
}

function fit(){
  const box=document.getElementById('stage').getBoundingClientRect();
  const s=Math.min((box.width-32)/img.width,(box.height-32)/img.height,1);
  c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
}

function draw(){
  ctx.clearRect(0,0,c.width,c.height);
  ctx.drawImage(img,0,0,c.width,c.height);
  it().boxes.forEach((b,i)=>{
    const x=(b.x-b.w/2)*c.width,y=(b.y-b.h/2)*c.height,
          w=b.w*c.width,h=b.h*c.height;
    ctx.lineWidth=i===sel?4:2.5;
    ctx.strokeStyle=COLORS[b.cls]||'#fff';
    ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=ctx.strokeStyle;
    ctx.fillRect(x,Math.max(0,y-19),ctx.measureText(classes[b.cls]||'?').width+14,19);
    ctx.fillStyle='#000'; ctx.font='600 12px sans-serif';
    ctx.fillText(classes[b.cls]||'?',x+7,Math.max(13,y-5));
  });
  if(drag){
    ctx.setLineDash([5,4]); ctx.lineWidth=2; ctx.strokeStyle=COLORS[cur];
    ctx.strokeRect(drag.x0,drag.y0,drag.x1-drag.x0,drag.y1-drag.y0);
    ctx.setLineDash([]);
  }
  paint();
}

function paint(){
  const n=items.length,done=items.filter(x=>x.status!=='todo').length;
  document.getElementById('fname').textContent=it().name;
  document.getElementById('pos').textContent=`${idx+1} of ${n}`+
    (it().suggested&&it().status==='todo'?' · suggestions are guesses':'');
  document.getElementById('prog').style.width=(100*done/n)+'%';
  document.getElementById('done').textContent=`${done} of ${n} reviewed`;
  document.getElementById('status').innerHTML=
    `<span class="badge ${it().status}">${it().status}</span>`;
  document.querySelectorAll('.cls').forEach(el=>
    el.classList.toggle('on',+el.dataset.i===cur));
  const b=it().boxes;
  document.getElementById('boxes').innerHTML = b.length
    ? b.map((x,i)=>`<div style="color:${COLORS[x.cls]}">${i===sel?'▶ ':'· '}`+
        `${classes[x.cls]}</div>`).join('')
    : '<span class="muted">none</span>';
}

function setCls(i){
  cur=i;
  if(sel>=0){it().boxes[sel].cls=i; it().status='done'; save();}
  draw();
}

c.onmousedown=e=>{
  const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  const hit=it().boxes.findIndex(b=>{
    const bx=(b.x-b.w/2)*c.width,by=(b.y-b.h/2)*c.height;
    return x>=bx&&x<=bx+b.w*c.width&&y>=by&&y<=by+b.h*c.height;});
  if(hit>=0&&!e.shiftKey){sel=hit;cur=it().boxes[hit].cls;draw();return;}
  drag={x0:x,y0:y,x1:x,y1:y};
};
c.onmousemove=e=>{
  if(!drag)return;
  const r=c.getBoundingClientRect();
  drag.x1=e.clientX-r.left; drag.y1=e.clientY-r.top; draw();
};
c.onmouseup=()=>{
  if(!drag)return;
  const x=Math.min(drag.x0,drag.x1),y=Math.min(drag.y0,drag.y1),
        w=Math.abs(drag.x1-drag.x0),h=Math.abs(drag.y1-drag.y0);
  if(w>6&&h>6){
    it().boxes.push({cls:cur,x:(x+w/2)/c.width,y:(y+h/2)/c.height,
                     w:w/c.width,h:h/c.height});
    sel=it().boxes.length-1; it().status='done'; save();
  }
  drag=null; draw();
};

async function save(){
  await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:it().name,boxes:it().boxes,status:it().status})});
}
function go(step){
  const n=idx+step;
  if(n<0||n>=items.length)return;
  idx=n; load();
}

addEventListener('keydown',e=>{
  if(e.key>='1'&&e.key<='3'){setCls(+e.key-1);e.preventDefault();return;}
  switch(e.key){
    case 'Backspace': case 'Delete':
      if(sel>=0){it().boxes.splice(sel,1);sel=-1;
        it().status=it().boxes.length?'done':'todo';save();draw();}
      e.preventDefault(); break;
    case 'a': case 'A':
      if(it().boxes.length){it().status='done';}
      else {it().status='negative';}
      save();draw();go(1);break;
    case 'n': case 'N':
      it().boxes=[];it().status='negative';sel=-1;save();draw();go(1);break;
    case 'x': case 'X':
      it().status='excluded';save();draw();go(1);break;
    case 'ArrowRight': case 'd': go(1); break;
    case 'ArrowLeft': go(-1); break;
  }
});
addEventListener('resize',()=>{if(img.width){fit();draw();}});

document.getElementById('finish').onclick=async()=>{
  const r=await(await fetch('/api/finish',{method:'POST'})).json();
  alert(`Exported ${r.kept} images (${r.negatives} with no defects).\n`+
        `Excluded ${r.excluded}. Not reviewed: ${r.todo}.\n\n`+
        Object.entries(r.counts).map(([k,v])=>`${k}: ${v} boxes`).join('\n')+
        `\n\nNow run:\npython3 training/propagate_labels.py ${r.out}`);
};
boot();
</script>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(DEFAULT_DIR), help="folder of images")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="dataset to write")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--review", action="store_true",
                    help="reviewing predicted labels rather than labelling fresh")
    args = ap.parse_args()

    src = Path(args.dir)
    if not src.exists():
        sys.exit(f"No such folder: {src}\nRun training/pick_seed.py first.")

    store = Store(src, Path(args.out), args.review)
    todo = sum(1 for v in store.state.values() if v["status"] == "todo")

    url = f"http://localhost:{args.port}"
    print(f"\n  {len(store.names)} images in {src}  ({todo} not yet reviewed)")
    print(f"\n  Open  {url}\n")
    print("  drag = box · 1/2/3 = class · A = accept as-is · N = no defects")
    print("  X = exclude · ←/→ = move")
    print("  Everything saves as you go. Ctrl-C when done.\n")

    server = HTTPServer(("127.0.0.1", args.port), make_handler(store))
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001 - headless is fine, the URL is printed
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped. Progress is saved; re-run to carry on.")
        store.export()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
