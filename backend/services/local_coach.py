"""TF-IDF index fitted on the bundled editorial corpus; not a generative LLM."""
import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

def tokens(text):
    return re.findall(r'[a-z]+', text.lower())

@lru_cache(maxsize=1)
def index():
    rows = json.loads((Path(__file__).resolve().parents[1] / 'data/coach_knowledge.json').read_text())
    docs = [Counter(tokens(row['queries'])) for row in rows]
    idf = {t: math.log((1 + len(docs)) / (1 + sum(t in d for d in docs))) + 1 for d in docs for t in d}
    return rows, docs, idf

def retrieve(message):
    if any(t in tokens(message) for t in ('pain', 'injury', 'injured', 'sore', 'tightness')):
        return ('Stop movements that cause pain. This local guide cannot assess an injury or clear you for heavy training. Discuss persistent or worsening symptoms with a qualified clinician.', 'injury')
    rows, docs, idf = index()
    query = Counter(tokens(message))
    scores = []
    for doc in docs:
        numerator = sum(query[t] * doc[t] * idf.get(t, 0)**2 for t in query)
        denominator = math.sqrt(sum((v * idf[t])**2 for t, v in doc.items()))
        scores.append(numerator / denominator if denominator else 0)
    best = max(range(len(scores)), key=scores.__getitem__)
    if not scores[best]:
        return ('I do not have a matching entry. Ask about squat, push-up, curl or pull-up technique, workout targets, recovery, or food logging.', 'unknown')
    return rows[best]['answer'], rows[best]['topic']
