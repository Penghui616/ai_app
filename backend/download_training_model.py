from backend.learning import MODEL_DIR, WEIGHT_FILE, WEIGHTS
from torch.hub import download_url_to_file
import hashlib

def main():
    MODEL_DIR.mkdir(parents=True,exist_ok=True)
    if WEIGHT_FILE.exists() and hashlib.sha256(WEIGHT_FILE.read_bytes()).hexdigest().startswith("5c1a4163"):
        print("MobileNetV3-Large V2 already verified.");return
    temp=WEIGHT_FILE.with_suffix(".partial")
    download_url_to_file(WEIGHTS.url,str(temp),hash_prefix="5c1a4163",progress=True)
    temp.replace(WEIGHT_FILE)
    print("Verified MobileNetV3-Large V2 downloaded.")
if __name__=="__main__":main()
