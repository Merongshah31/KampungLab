"""FastAPI Backend for KampungLab PWA.

Provides:
- POST /api/analyze: Multimodal STEM learning analysis ('Cikgu KampungLab')
  supporting Bahasa Melayu, Melayu Sarawak, and Iban with strict JSON output.
- GET /api/health: Health check endpoint for Google Cloud Run.
- Static file serving at / for the production React + Vite PWA build.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from backend.prompts import build_system_prompt
except ModuleNotFoundError:
    from prompts import build_system_prompt

_backend_dir = Path(__file__).resolve().parent
_project_root = _backend_dir.parent
for _env_candidate in [
    _backend_dir / ".env",
    _project_root / ".env",
    _project_root / "ambient-expense-agent" / ".env",
]:
    if _env_candidate.is_file():
        load_dotenv(_env_candidate, override=False)
load_dotenv()

# Auto-detect sekiranya kunci OpenRouter diletakkan di dalam GEMINI_API_KEY
_gemini_key = os.getenv("GEMINI_API_KEY", "")
if _gemini_key.startswith("sk-or-v1-"):
    if not os.getenv("OPENROUTER_API_KEY"):
        os.environ["OPENROUTER_API_KEY"] = _gemini_key
        os.environ.setdefault("LLM_PROVIDER", "openrouter")
    del os.environ["GEMINI_API_KEY"]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kampunglab")

ALLOWED_LANGUAGES = {
    "Bahasa Melayu": "Bahasa Melayu",
    "Melayu Sarawak": "Melayu Sarawak",
    "Bahasa Melayu Sarawak": "Melayu Sarawak",
    "Iban": "Iban",
    "Bahasa Iban": "Iban",
}


class STEMAnalysisResponse(BaseModel):
    """Strict JSON schema required from the LLM for Cikgu KampungLab."""

    title: str = Field(
        ...,
        description="Tajuk konsep STEM berdasarkan objek harian dalam gambar.",
    )
    explanation: str = Field(
        ...,
        description="Penerangan mesra pelajar dalam bahasa/dialek yang dipilih menggunakan analogi tempatan.",
    )
    svg_code: str = Field(
        ...,
        description="Kod <svg> lengkap dan sah berserta animasi CSS ringkas di dalamnya.",
    )
    quiz_question: str = Field(
        ...,
        description="Satu soalan kuiz pendek untuk menguji kefahaman pelajar.",
    )
    quiz_options: List[str] = Field(
        default_factory=list,
        description="Senarai 3 pilihan jawapan pendek untuk kuiz interaktif.",
    )
    quiz_answer: Optional[str] = Field(
        default=None,
        description="Jawapan betul daripada senarai quiz_options.",
    )
    quiz_explanation: Optional[str] = Field(
        default=None,
        description="Penjelasan ringkas mengapa jawapan kuiz tersebut betul.",
    )


app = FastAPI(
    title="KampungLab PWA API",
    description="Backend API untuk Cikgu KampungLab - Ejen Pembelajaran STEM Luar Bandar",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _decode_base64_image(data_str: str) -> tuple[bytes, str]:
    """Extract raw image bytes and MIME type from a Base64 string or Data URL."""
    mime_type = "image/jpeg"
    cleaned = data_str.strip()
    if cleaned.startswith("data:"):
        header, _, b64_part = cleaned.partition(",")
        match = re.match(r"data:([^;]+);base64", header)
        if match:
            mime_type = match.group(1)
        cleaned = b64_part
    try:
        image_bytes = base64.b64decode(cleaned)
        return image_bytes, mime_type
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Rentetan Base64 imej tidak sah: {exc}",
        ) from exc


def _ensure_valid_svg(svg_code: str, title: str) -> str:
    """Ensure the returned svg_code contains a valid <svg> root element without <script>."""
    cleaned = svg_code.strip()
    # Extract <svg>...</svg> if wrapped in markdown code fences
    match = re.search(r"(<svg[\s\S]*?</svg>)", cleaned, flags=re.IGNORECASE)
    if match:
        cleaned = match.group(1)
    # Remove any <script> tags for security
    cleaned = re.sub(
        r"<script[\s\S]*?</script>", "", cleaned, flags=re.IGNORECASE
    )
    if not cleaned.lower().startswith("<svg"):
        cleaned = f"""<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
  <style>
    .pulse {{ animation: pulseAnim 2.2s infinite ease-in-out; transform-origin: center; }}
    @keyframes pulseAnim {{ 0%, 100% {{ transform: scale(0.95); opacity: 0.85; }} 50% {{ transform: scale(1.06); opacity: 1; }} }}
  </style>
  <rect width="400" height="240" rx="16" fill="#ecfdf5"/>
  <circle cx="200" cy="115" r="55" fill="#10b981" class="pulse"/>
  <text x="200" y="120" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="14" font-weight="bold">{title[:28]}</text>
</svg>"""
    return cleaned


def _analyze_with_gemini(
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    language: str,
) -> STEMAnalysisResponse:
    """Call Google GenAI SDK (gemini-2.5-flash) with structured JSON schema."""
    from google import genai
    from google.genai import types

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in (
        "1",
        "true",
        "yes",
    )

    if use_vertex:
        client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
    else:
        client = genai.Client(api_key=api_key)

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    system_instruction = build_system_prompt(language)

    user_prompt = (
        f"Bahasa/Dialek Pilihan: {language}\n"
        f"Soalan Pelajar: {prompt or 'Terangkan konsep STEM bagi objek dalam gambar ini.'}\n\n"
        "Sila analisis imej ini sebagai Cikgu KampungLab dan pulangkan JSON mengikut skema."
    )

    response = client.models.generate_content(
        model=model_name,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            user_prompt,
        ],
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=STEMAnalysisResponse,
            temperature=0.4,
        ),
    )

    raw_text = response.text or "{}"
    data = json.loads(raw_text)
    parsed = STEMAnalysisResponse(**data)
    parsed.svg_code = _ensure_valid_svg(parsed.svg_code, parsed.title)
    return parsed


def _analyze_with_openai_compatible(
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    language: str,
) -> STEMAnalysisResponse:
    """Call OpenAI or OpenRouter Vision API with strict JSON response."""
    from openai import OpenAI

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if openrouter_key:
        client = OpenAI(
            api_key=openrouter_key,
            base_url=os.getenv(
                "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
            ),
        )
        model_name = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    else:
        client = OpenAI(
            api_key=openai_key,
            base_url=os.getenv("OPENAI_BASE_URL"),
        )
        model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    b64_img = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime_type};base64,{b64_img}"
    system_instruction = build_system_prompt(language)

    user_prompt = (
        f"Bahasa/Dialek Pilihan: {language}\n"
        f"Soalan Pelajar: {prompt or 'Terangkan konsep STEM bagi objek dalam gambar ini.'}\n\n"
        "Pulangkan JSON sahaja yang mempunyai kunci: title, explanation, svg_code, "
        "quiz_question, quiz_options (senarai 3 rentetan), quiz_answer, dan quiz_explanation."
    )

    completion = client.chat.completions.create(
        model=model_name,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_instruction},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        temperature=0.4,
    )

    raw_text = completion.choices[0].message.content or "{}"
    data = json.loads(raw_text)
    parsed = STEMAnalysisResponse(**data)
    parsed.svg_code = _ensure_valid_svg(parsed.svg_code, parsed.title)
    return parsed


def _build_demo_fallback(prompt: str, language: str) -> STEMAnalysisResponse:
    """Provide an offline/demo Cikgu KampungLab response when no API key is configured."""
    clean_prompt = (prompt or "Objek Harian").strip()

    svg_diagram = """<svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
  <style>
    .sun-ray { animation: rayPulse 2.4s ease-in-out infinite; transform-origin: 70px 55px; }
    .arrow-flow { stroke-dasharray: 8 5; animation: flowDash 1.4s linear infinite; }
    .leaf-glow { animation: leafBreathe 3s ease-in-out infinite; transform-origin: 210px 135px; }
    .bubble { animation: floatUp 2.6s ease-in-out infinite; }
    @keyframes rayPulse {
      0%, 100% { transform: scale(0.94); opacity: 0.8; }
      50% { transform: scale(1.08); opacity: 1; }
    }
    @keyframes flowDash {
      to { stroke-dashoffset: -26; }
    }
    @keyframes leafBreathe {
      0%, 100% { transform: rotate(-2deg) scale(0.98); }
      50% { transform: rotate(2deg) scale(1.03); }
    }
    @keyframes floatUp {
      0%, 100% { transform: translateY(4px); opacity: 0.75; }
      50% { transform: translateY(-6px); opacity: 1; }
    }
  </style>

  <!-- Background -->
  <rect width="400" height="250" rx="16" fill="#f0fdf4"/>
  <rect x="8" y="8" width="384" height="234" rx="12" fill="none" stroke="#bbf7d0" stroke-width="1.5"/>

  <!-- Sun (Light Energy) -->
  <g class="sun-ray">
    <circle cx="70" cy="55" r="24" fill="#facc15" stroke="#eab308" stroke-width="2"/>
    <circle cx="70" cy="55" r="32" fill="none" stroke="#fde047" stroke-width="2" stroke-dasharray="6 6"/>
  </g>
  <text x="70" y="102" text-anchor="middle" fill="#854d0e" font-family="sans-serif" font-size="11" font-weight="bold">Cahaya (Tenaga)</text>

  <!-- Energy Flow Arrow -->
  <path d="M 105 68 Q 145 85 170 110" fill="none" stroke="#eab308" stroke-width="3" class="arrow-flow"/>

  <!-- Object / Leaf / Mechanism Center -->
  <g class="leaf-glow">
    <path d="M 160 145 C 160 95, 250 85, 265 135 C 250 185, 160 175, 160 145 Z" fill="#10b981" stroke="#047857" stroke-width="2.5"/>
    <path d="M 162 145 Q 210 135 262 135" fill="none" stroke="#d1fae5" stroke-width="2.5"/>
    <path d="M 195 140 L 182 122 M 215 137 L 205 116 M 232 136 L 222 152" stroke="#d1fae5" stroke-width="1.8" stroke-linecap="round"/>
  </g>
  <text x="212" y="192" text-anchor="middle" fill="#065f46" font-family="sans-serif" font-size="12" font-weight="bold">Pemprosesan Tenaga &amp; Daya</text>

  <!-- Water / Input from Roots -->
  <path d="M 210 232 L 210 170" fill="none" stroke="#0284c7" stroke-width="3" class="arrow-flow"/>
  <text x="210" y="243" text-anchor="middle" fill="#0369a1" font-family="sans-serif" font-size="10" font-weight="bold">Input Air / Daya Asas (H₂O)</text>

  <!-- Output Oxygen / Work -->
  <path d="M 268 128 Q 305 110 330 85" fill="none" stroke="#059669" stroke-width="3" class="arrow-flow"/>
  <g class="bubble">
    <circle cx="342" cy="70" r="18" fill="#34d399" opacity="0.25"/>
    <circle cx="342" cy="70" r="13" fill="#10b981"/>
    <text x="342" y="74" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="10" font-weight="bold">O₂</text>
  </g>
  <text x="342" y="105" text-anchor="middle" fill="#065f46" font-family="sans-serif" font-size="11" font-weight="bold">Output / Hasil</text>
</svg>"""

    if language == "Melayu Sarawak":
        return STEMAnalysisResponse(
            title=f"Sains & Tenaga Di Sebalik Objek ({clean_prompt[:32]})",
            explanation=(
                "Selamat datang ke KampungLab! Cuba kitak perati gambar objek tok. "
                "Dalam dunia Sains & STEM, setiap objek harian di sekeliling kampung kitak ada konsep pertukaran tenaga dan keseimbangan daya. "
                "Ibarat kitak berkayuh perahu tambang menyeberang Sungai Sarawak atau memasak di dapur kayu rumah kampung—tenaga input (cahaya matahari, haba, atau tolakan tangan) "
                "ditukar menjadi tenaga kerja atau tindak balas biologi/fizik yang berguna! "
                "Nang hebat ciptaan alam bila kitak faham cara ia berfungsi."
            ),
            svg_code=svg_diagram,
            quiz_question="Apakah prinsip utama apabila sesuatu objek atau tumbuhan menukar tenaga cahaya/input kepada hasil baharu?",
            quiz_options=[
                "Prinsip Keabadian & Pertukaran Tenaga",
                "Tenaga hilang begitu sahaja ke udara",
                "Objek bergerak tanpa sebarang daya atau tenaga",
            ],
            quiz_answer="Prinsip Keabadian & Pertukaran Tenaga",
            quiz_explanation=(
                "Tepat sekali kitak! Mengikut Hukum Keabadian Tenaga, tenaga sik boleh dicipta atau dimusnahkan, "
                "tetapi berubah bentuk daripada satu bentuk (input) kepada bentuk yang lain (output)."
            ),
        )

    if language == "Iban":
        return STEMAnalysisResponse(
            title=f"Penemu Sains & Kuasa Alam ({clean_prompt[:32]})",
            explanation=(
                "Selamat datai ke KampungLab, bala nembiak! Peda enggau silik gambar utai ti dikirum nuan tu. "
                "Dalam penemu STEM, semua utai baelingi rumah panjai tauka menua kitai bepanggai ba konsep kuasa (daya) enggau ubah tenaga. "
                "Baka kitai ke ngaga perau panjai melunggang arus sungai tauka utai tumbuh ti ngambi cahya mata panas kena ngaga pemakai (fotosintesis)—"
                "kuasa input diubah nyadi pengawa tauka output ti meri penguntung ngagai mensia enggau rampa menua!"
            ),
            svg_code=svg_diagram,
            quiz_question="Nama kebuah cahya mata panas tauka daya input beguna amat ba proses sains dalam gambar tu?",
            quiz_options=[
                "Laban iya meri tenaga pemungkal kena ngubah input nyadi hasil (output)",
                "Laban iya ngasuh utai nya lenyau nadai bekau",
                "Laban daya nadai kaul enggau gerak tauka proses biologi",
            ],
            quiz_answer="Laban iya meri tenaga pemungkal kena ngubah input nyadi hasil (output)",
            quiz_explanation=(
                "Manah amat saut nuan! Tenaga pemungkal (baka cahya mata panas tauka daya tolakan) "
                "endang پمuka jalai ngagai proses sains enggau mekanikal."
            ),
        )

    return STEMAnalysisResponse(
        title=f"Konsep Tenaga, Daya & Sistem STEM ({clean_prompt[:32]})",
        explanation=(
            "Tahniah kerana bertanya kepada Cikgu KampungLab! Berdasarkan gambar objek harian yang awak hantar, "
            "kita dapat melihat prinsip asas STEM iaitu bagaimana **Input Tenaga/Daya** diproses oleh sesuatu sistem untuk menghasilkan **Output yang berguna**. "
            "Bayangkan seperti kayuhan basikal di jalan kampung atau daun pokok kelapa di tepi sungai yang menyerap cahaya matahari (fotosintesis): "
            "tenaga tidak hilang begitu sahaja, sebaliknya bertukar bentuk untuk menggerakkan mekanisme atau menghasilkan oksigen dan glukosa!"
        ),
        svg_code=svg_diagram,
        quiz_question="Mengikut prinsip asas sains, apakah yang berlaku kepada tenaga apabila sesuatu proses fizik atau biologi berlaku?",
        quiz_options=[
            "Tenaga berubah bentuk daripada satu bentuk kepada bentuk yang lain",
            "Tenaga musnah sepenuhnya selepas digunakan",
            "Tenaga muncul secara tiba-tiba tanpa sebarang sumber",
        ],
        quiz_answer="Tenaga berubah bentuk daripada satu bentuk kepada bentuk yang lain",
        quiz_explanation=(
            "Betul! Prinsip Keabadian Tenaga menyatakan bahawa tenaga tidak boleh dicipta atau dimusnahkan, "
            "tetapi sentiasa berubah bentuk (contohnya: tenaga cahaya kepada tenaga kimia, atau tenaga kinetik kepada kerja)."
        ),
    )


@app.get("/api/health")
async def health_check():
    """Health check endpoint for Cloud Run readiness/liveness probes."""
    has_gemini = bool(
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("GOOGLE_GENAI_USE_VERTEXAI")
    )
    has_openai = bool(
        os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    )
    return {
        "status": "ok",
        "service": "KampungLab PWA",
        "agent": "Cikgu KampungLab",
        "llm_configured": has_gemini or has_openai,
        "supported_languages": ["Bahasa Melayu", "Melayu Sarawak", "Iban"],
    }


@app.post(
    "/api/analyze",
    response_model=STEMAnalysisResponse,
    summary="Analisis Imej Objek Harian bersama Cikgu KampungLab",
    openapi_extra={
        "requestBody": {
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "image": {
                                "type": "string",
                                "format": "binary",
                                "description": "Fail imej objek harian (JPEG/PNG/WebP)",
                            },
                            "image_base64": {
                                "type": "string",
                                "description": "Pilihan alternatif: Rentetan imej Base64 / Data URL",
                            },
                            "prompt": {
                                "type": "string",
                                "description": "Soalan pelajar tentang objek di dalam gambar",
                            },
                            "language": {
                                "type": "string",
                                "enum": ["Bahasa Melayu", "Melayu Sarawak", "Iban"],
                                "default": "Bahasa Melayu",
                            },
                        },
                    }
                },
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "image_base64": {
                                "type": "string",
                                "description": "Rentetan imej Base64 / Data URL",
                            },
                            "prompt": {
                                "type": "string",
                                "description": "Soalan pelajar tentang objek di dalam gambar",
                            },
                            "language": {
                                "type": "string",
                                "enum": ["Bahasa Melayu", "Melayu Sarawak", "Iban"],
                                "default": "Bahasa Melayu",
                            },
                        },
                        "required": ["image_base64"],
                    }
                },
            }
        }
    },
)
async def analyze_image(request: Request):
    """Endpoint POST /api/analyze.

    Menerima fail imej (atau rentetan Base64), teks soalan (prompt),
    dan pilihan bahasa/dialek ('Bahasa Melayu', 'Melayu Sarawak', atau 'Iban').
    """
    content_type = request.headers.get("content-type", "").lower()

    image_bytes: Optional[bytes] = None
    mime_type: str = "image/jpeg"
    prompt: str = ""
    language_raw: str = "Bahasa Melayu"

    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        prompt = str(form.get("prompt") or "").strip()
        language_raw = str(form.get("language") or "Bahasa Melayu").strip()

        upload_file = form.get("image")
        b64_field = form.get("image_base64")

        if upload_file is not None and hasattr(upload_file, "read"):
            image_bytes = await upload_file.read()
            mime_type = getattr(upload_file, "content_type", None) or "image/jpeg"
        elif isinstance(upload_file, str) and upload_file.strip():
            image_bytes, mime_type = _decode_base64_image(upload_file)
        elif isinstance(b64_field, str) and b64_field.strip():
            image_bytes, mime_type = _decode_base64_image(b64_field)
    else:
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Format permintaan tidak sah. Hantar multipart/form-data atau JSON: {exc}",
            ) from exc

        prompt = str(body.get("prompt") or "").strip()
        language_raw = str(body.get("language") or "Bahasa Melayu").strip()
        b64_str = body.get("image_base64") or body.get("image")
        if isinstance(b64_str, str) and b64_str.strip():
            image_bytes, mime_type = _decode_base64_image(b64_str)

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Sila muat naik fail imej ('image') atau hantar rentetan Base64 ('image_base64').",
        )

    normalized_language = ALLOWED_LANGUAGES.get(language_raw)
    if not normalized_language:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pilihan bahasa '{language_raw}' tidak disokong. "
                "Sila pilih 'Bahasa Melayu', 'Melayu Sarawak', atau 'Iban'."
            ),
        )

    has_gemini = bool(
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true", "yes")
    )
    has_openai = bool(
        os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    )
    provider_pref = os.getenv("LLM_PROVIDER", "").lower()

    provider_used = "demo-fallback"
    try:
        if provider_pref in ("openai", "openrouter") and has_openai:
            result = _analyze_with_openai_compatible(
                image_bytes=image_bytes,
                mime_type=mime_type,
                prompt=prompt,
                language=normalized_language,
            )
            provider_used = "openai-compatible"
        elif has_gemini:
            result = _analyze_with_gemini(
                image_bytes=image_bytes,
                mime_type=mime_type,
                prompt=prompt,
                language=normalized_language,
            )
            provider_used = "gemini-2.5-flash"
        elif has_openai:
            result = _analyze_with_openai_compatible(
                image_bytes=image_bytes,
                mime_type=mime_type,
                prompt=prompt,
                language=normalized_language,
            )
            provider_used = "openai-compatible"
        else:
            logger.warning(
                "Tiada GEMINI_API_KEY atau OPENAI_API_KEY/OPENROUTER_API_KEY ditemui. "
                "Menggunakan respons simulasi Cikgu KampungLab."
            )
            result = _build_demo_fallback(prompt=prompt, language=normalized_language)
            provider_used = "demo-fallback"
    except Exception as exc:
        logger.exception("Ralat semasa memanggil API LLM Vision: %s", exc)
        if os.getenv("STRICT_LLM_ERRORS", "").lower() in ("1", "true", "yes"):
            raise HTTPException(
                status_code=502,
                detail=f"Gagal menghubungi Cikgu KampungLab (LLM API): {exc}",
            ) from exc
        result = _build_demo_fallback(prompt=prompt, language=normalized_language)
        provider_used = "demo-fallback-on-error"

    return JSONResponse(
        content=result.model_dump(),
        headers={"X-KampungLab-Provider": provider_used},
    )


# ---------------------------------------------------------------------------
# Static File Serving for Production React Build (Frontend)
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_Candidates = [
    PROJECT_ROOT / "static",
    PROJECT_ROOT / "frontend" / "dist",
]

STATIC_DIR: Optional[Path] = next(
    (candidate for candidate in STATIC_Candidates if candidate.is_dir()),
    None,
)

if STATIC_DIR is not None:
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve static files from React production build or fallback to index.html."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")

        requested_file = (STATIC_DIR / full_path).resolve()
        if (
            full_path
            and requested_file.is_file()
            and str(requested_file).startswith(str(STATIC_DIR.resolve()))
        ):
            return FileResponse(str(requested_file))

        index_file = STATIC_DIR / "index.html"
        if index_file.is_file():
            return FileResponse(str(index_file))

        return JSONResponse(
            status_code=404,
            content={"message": "Frontend build index.html not found."},
        )
else:
    @app.get("/", include_in_schema=False)
    async def root_status():
        return {
            "service": "KampungLab PWA Backend",
            "message": (
                "Frontend production build belum dibina. "
                "Jalankan 'npm run build' di dalam folder frontend/ atau gunakan Docker."
            ),
            "docs": "/docs",
        }
