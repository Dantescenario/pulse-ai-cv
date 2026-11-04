FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
# Native runtime libraries required by OpenCV contrib and MediaPipe Tasks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxcb1 libgl1 libegl1 libgles2 libglib2.0-0 libportaudio2 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements*.txt /app/backend/
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-ml.txt
COPY backend/ /app/backend/
RUN python backend/training/install_food_model.py
COPY --from=frontend /build/dist /app/frontend/dist
COPY --from=frontend /build/src/utils/repConfig.json /app/frontend/src/utils/repConfig.json
ENV DATABASE_PATH=/data/pulse_fitness.db HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 MPLCONFIGDIR=/home/appuser/.config/matplotlib
RUN mkdir /data && useradd --create-home --uid 10001 appuser && chown appuser /data
USER appuser
WORKDIR /app/backend
# Fail the build if native imports, shared configuration or pose assets are missing.
RUN python -c "from services.video_analysis_service import MEDIAPIPE_AVAILABLE, _create_pose_landmarker; assert MEDIAPIPE_AVAILABLE, 'MediaPipe could not import'; pose = _create_pose_landmarker(); pose.close()"
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
