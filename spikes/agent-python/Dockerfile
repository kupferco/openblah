# Build from the repo root: docker build -f spikes/agent-python/Dockerfile -t openblah-agent-py spikes/agent-python
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .
# Bake the turn detector and VAD model files into the image (no download at cold start).
RUN python worker.py download-files
CMD ["python", "worker.py", "start"]
