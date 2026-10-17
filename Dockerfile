# ============================================================================
# Stage 1: Node.js Builder — Bina React + Vite + Tailwind CSS PWA Frontend
# ============================================================================
FROM node:20-slim AS frontend-builder

WORKDIR /build/frontend

# Salin fail konfigurasi pakej terlebih dahulu untuk memanfaatkan cache Docker
COPY frontend/package*.json ./
RUN npm install

# Salin kod sumber frontend dan jalankan binaan production
COPY frontend/ ./
RUN npm run build


# ============================================================================
# Stage 2: Python Slim Runtime — Jalankan FastAPI + Uvicorn pada Google Cloud Run
# ============================================================================
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Pasang kebergantungan Python untuk FastAPI & Google GenAI / OpenAI SDK
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend/requirements.txt

# Salin kod backend FastAPI
COPY backend/ ./backend/

# Salin hasil binaan production React daripada Stage 1 ke dalam /app/static
COPY --from=frontend-builder /build/frontend/dist ./static

EXPOSE 8080

# Jalankan pelayan Uvicorn pada port $PORT (default 8080 untuk Google Cloud Run)
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
