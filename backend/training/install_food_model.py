"""One-time public model installation; no token or hosted inference API."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.food_model import MODEL_DIR
from transformers import AutoImageProcessor, AutoModelForImageClassification

if __name__ == '__main__':
    model_id = 'nateraw/food'
    AutoImageProcessor.from_pretrained(model_id).save_pretrained(MODEL_DIR)
    AutoModelForImageClassification.from_pretrained(model_id).save_pretrained(MODEL_DIR, safe_serialization=True)
    print(f'Installed Food-101 model at {MODEL_DIR}')
