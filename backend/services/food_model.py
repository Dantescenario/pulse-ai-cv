"""CPU-only, offline inference. Download weights explicitly during setup/build."""
import io
import os
from functools import lru_cache
from pathlib import Path

MODEL_DIR = Path(os.getenv('FOOD_MODEL_DIR', str(Path(__file__).resolve().parents[1] / 'models/food101')))

def model_ready():
    return (MODEL_DIR / 'config.json').is_file() and any((MODEL_DIR / n).is_file() for n in ('model.safetensors', 'pytorch_model.bin'))

@lru_cache(maxsize=1)
def load_classifier():
    if not model_ready():
        raise RuntimeError('Local food model missing. Run python backend/training/install_food_model.py, then restart.')
    try:
        from transformers import AutoImageProcessor, AutoModelForImageClassification
        processor = AutoImageProcessor.from_pretrained(MODEL_DIR, local_files_only=True, use_fast=False)
        model = AutoModelForImageClassification.from_pretrained(MODEL_DIR, local_files_only=True, use_fast=False)
        model.eval()
        return processor, model
    except (ImportError, OSError) as exc:
        raise RuntimeError('Local food model could not load. Install backend/requirements-ml.txt and reinstall the model.') from exc

def classify(raw):
    from PIL import Image, UnidentifiedImageError
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(raw))
            if image.width * image.height > 20000000:
                raise ValueError('Image exceeds 20 megapixels. Resize before uploading.')
            image = image.convert('RGB')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise ValueError('Could not decode image. Use a smaller valid food photo.') from None
    processor, model = load_classifier()
    import torch
    with torch.inference_mode():
        scores, indices = model(**processor(images=image, return_tensors='pt')).logits.softmax(-1)[0].topk(3)
    if float(scores[0]) < 0.35:
        raise ValueError('No confident food match. Choose a clearer single-food photo or use catalogue search.')
    return [{'label': model.config.id2label[int(i)].replace('_', ' '), 'confidence': round(float(s), 4)} for s, i in zip(scores, indices)]
