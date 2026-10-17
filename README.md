# KampungLab PWA — Ejen Pembelajaran STEM Luar Bandar (Cikgu KampungLab)

Aplikasi web monorepo penuh (**FastAPI + React + Vite + Tailwind CSS + PWA**) yang direka khas untuk kawasan jalur lebar rendah (*low-bandwidth*) dan sedia di-deploy ke **Google Cloud Run** menggunakan satu `Dockerfile` *multi-stage*.

---

## Ciri-Ciri Utama

1. **Backend (Python FastAPI)**
   - **Endpoint `POST /api/analyze`**: Menerima fail imej (`multipart/form-data`) atau rentetan Base64 (`image_base64`), teks soalan (`prompt`), dan pilihan bahasa/dialek (`Bahasa Melayu`, `Melayu Sarawak`, atau `Iban`).
   - **Integrasi LLM Vision**: Menggunakan SDK rasmi **Google GenAI (`gemini-2.5-flash`)** dengan sokongan keserasian **OpenAI / OpenRouter** serta mod *fallback* pintar sekiranya kunci API belum ditetapkan.
   - **Persona AI `'Cikgu KampungLab'`**: Menerangkan konsep Sains, Matematik, Kejuruteraan, dan IT daripada gambar objek harian menggunakan analogi tempatan (contoh: perahu tambang, jambatan gantung kampung, pokok kelapa, rumah panjang).
   - **Output JSON Ketat**:
     - `title`: Tajuk konsep STEM.
     - `explanation`: Penerangan mesra pelajar dalam bahasa/dialek pilihan.
     - `svg_code`: Kod `<svg>` lengkap dan sah berserta animasi CSS (`@keyframes`) di dalamnya.
     - `quiz_question`: Soalan kuiz pendek berserta pilihan interaktif (`quiz_options`, `quiz_answer`, `quiz_explanation`).
   - **Static File Serving**: Menghidangkan binaan *production* React PWA secara terus pada laluan `/`.

2. **Frontend (React + Vite + Tailwind CSS + PWA)**
   - **Reka Bentuk Mudah Alih (*Mobile-First*)**: Antara muka yang bersih, pantas, dan ringan.
   - **Kompresi Imej Sisi Klien (HTML5 Canvas)**: Mengecilkan resolusi imej kepada lebar maksimum `600px` dengan kualiti JPEG `0.6` sebelum dihantar ke pelayan, serta memaparkan saiz fail selepas dikompres (dalam **KB**).
   - **Input Suara Bahasa Melayu (`ms-MY`)**: Menggunakan `webkitSpeechRecognition` (Web Speech API).
   - **Pilihan Bahasa & Dialek**: *Bahasa Melayu*, *Bahasa Melayu Sarawak*, dan *Bahasa Iban*.
   - **Lencana `'Low-Bandwidth Mode Active'`**: Memaparkan jumlah saiz **KB** payload JSON yang diterima daripada pelayan.
   - **Bekas Visual SVG Selamat & Kuiz Interaktif**: Memaparkan ilustrasi vektor `<svg>` beranimasi selepas disanitasi, diikuti penerangan teks dan kuiz interaktif.

---

## Struktur Monorepo

```text
.
├── Dockerfile                  # Multi-stage Dockerfile (Node.js build -> Python slim Uvicorn $PORT/8080)
├── .dockerignore               # Konfigurasi abaikan fail Docker
├── .env.example                # Contoh pemboleh ubah persekitaran
├── backend/
│   ├── __init__.py
│   ├── main.py                 # Aplikasi FastAPI, endpoint POST /api/analyze & static serving
│   ├── prompts.py              # System prompt 'Cikgu KampungLab' & panduan dialek
│   └── requirements.txt        # Senarai pakej Python
└── frontend/
    ├── index.html              # Pautan manifest PWA & meta mobile-first
    ├── package.json            # Kebergantungan React, Vite & Tailwind CSS
    ├── vite.config.js          # Konfigurasi Vite & proksi /api
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── public/
    │   ├── manifest.json       # Web App Manifest PWA
    │   ├── sw.js               # Service Worker PWA
    │   └── icon.svg            # Ikon vektor KampungLab
    └── src/
        ├── main.jsx            # Pendaftaran Service Worker & titik mula React
        ├── index.css           # Gaya Tailwind CSS
        ├── App.jsx             # Komponen utama KampungLab PWA
        └── utils/
            ├── imageCompression.js  # Kompresi imej HTML5 Canvas (600px, JPEG 0.6)
            └── sanitizeSvg.js       # Sanitasi selamat kod <svg> & animasi CSS
```

---

## Cara Menjalankan Secara Tempatan (Local Development)

### 1. Tetapkan Kunci API
Salin `.env.example` kepada `.env` dan masukkan kunci API anda:
```bash
cp .env.example .env
# Tetapkan GEMINI_API_KEY=... di dalam .env
```

### 2. Bina Frontend & Jalankan Backend FastAPI
```bash
# Bina frontend React
cd frontend
npm install
npm run build
cd ..

# Pasang pakej Python dan jalankan FastAPI pada port 8080
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload
```
Buka `http://localhost:8080` pada pelayar anda.

---

## Deployment ke Google Cloud Run

Aplikasi ini menggunakan satu `Dockerfile` *multi-stage* pada akar projek:

```bash
# Deploy terus ke Google Cloud Run dari kod sumber
gcloud run deploy kampunglab-pwa \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your-gemini-api-key"
```
