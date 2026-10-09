"""Download only pinned, non-executable model artifacts. No access token required."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from backend.model_spec import MODEL_DIR, REPOSITORY, REVISION

FILES = ["config.json", "preprocessor_config.json", "model.safetensors", "README.md"]
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"VisionLab/0.5"}), timeout=120)

def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with get(f"https://huggingface.co/api/models/{REPOSITORY}/tree/{REVISION}") as response:
        entries = {entry["path"]:entry for entry in json.load(response)}
    manifest = {"repository":REPOSITORY, "revision":REVISION, "files":{}}
    for name in FILES:
        entry = entries[name]
        expected = entry.get("lfs", {}).get("oid")
        target = MODEL_DIR / name
        if target.exists() and expected and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            print(f"Verified existing {name}", flush=True)
        else:
            partial = target.with_suffix(target.suffix + ".partial")
            for attempt in range(4):
                try:
                    print(f"Downloading {name} ({entry['size']} bytes), attempt {attempt+1}", flush=True)
                    with get(f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}") as response, partial.open("wb") as output:
                        while chunk := response.read(1024*1024): output.write(chunk)
                    if partial.stat().st_size != entry["size"]: raise ValueError("Incomplete download")
                    if expected and hashlib.sha256(partial.read_bytes()).hexdigest() != expected: raise ValueError("Checksum mismatch")
                    partial.replace(target)
                    break
                except Exception:
                    if attempt == 3: raise
                    time.sleep(2)
        manifest["files"][name] = hashlib.sha256(target.read_bytes()).hexdigest()
    (MODEL_DIR / "manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    print(f"Model ready in {MODEL_DIR}",flush=True)
if __name__ == "__main__": main()
