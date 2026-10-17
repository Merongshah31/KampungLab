import React, { useState, useRef } from 'react';
import {
  compressImageWithCanvas,
  createSampleCanvasImage,
} from './utils/imageCompression.js';
import { sanitizeSvgCode } from './utils/sanitizeSvg.js';

const LANGUAGE_OPTIONS = [
  { value: 'Bahasa Melayu', label: 'Bahasa Melayu (Standard)' },
  { value: 'Melayu Sarawak', label: 'Bahasa Melayu Sarawak' },
  { value: 'Iban', label: 'Bahasa Iban (Jaku Iban)' },
];

const QUICK_PROMPTS = [
  'Terangkan konsep sains pada objek dalam gambar ini.',
  'Apakah daya atau tenaga yang terlibat pada objek ini?',
  'Bagaimana objek ini berkait dengan matematik atau algoritma?',
];

export default function App() {
  // Image & Canvas Compression State
  const [imageData, setImageData] = useState(null); // { blob, dataUrl, originalKb, compressedKb, width, height }
  const [compressing, setCompressing] = useState(false);

  // Prompt, Voice & Dialect State
  const [prompt, setPrompt] = useState(
    'Terangkan konsep STEM bagi objek harian dalam gambar ini.'
  );
  const [language, setLanguage] = useState('Bahasa Melayu');
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');

  // API & Low-Bandwidth Metrics State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [payloadKb, setPayloadKb] = useState(0);
  const [providerUsed, setProviderUsed] = useState('');

  // Interactive Quiz State
  const [selectedOption, setSelectedOption] = useState(null);
  const [userQuizNotes, setUserQuizNotes] = useState('');
  const [showQuizFeedback, setShowQuizFeedback] = useState(false);

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const recognitionRef = useRef(null);

  // Handle file selection from Camera or Gallery and compress via HTML5 Canvas
  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    setCompressing(true);
    try {
      const compressed = await compressImageWithCanvas(file, 600, 0.6);
      setImageData(compressed);
    } catch (err) {
      setError(err.message || 'Ralat semasa mengompres imej.');
    } finally {
      setCompressing(false);
    }
  };

  // Load sample everyday object image compressed via HTML5 Canvas
  const handleLoadSampleImage = async () => {
    setError('');
    setCompressing(true);
    try {
      const sample = await createSampleCanvasImage(600, 0.6);
      setImageData(sample);
    } catch (err) {
      setError('Gagal memuatkan imej contoh.');
    } finally {
      setCompressing(false);
    }
  };

  // Voice Input using webkitSpeechRecognition (Web Speech API) for ms-MY
  const handleToggleVoiceInput = () => {
    setSpeechNotice('');
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechNotice(
        'Pelayar anda tidak menyokong webkitSpeechRecognition. Sila gunakan Chrome/Edge atau taip soalan anda.'
      );
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ms-MY';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setSpeechNotice('Mendengar suara anda (Bahasa Melayu ms-MY)...');
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((res) => res[0].transcript)
        .join(' ')
        .trim();

      if (transcript) {
        setPrompt((prev) =>
          prev ? `${prev.trim()} ${transcript}` : transcript
        );
        setSpeechNotice(`Suara dikesan: "${transcript}"`);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setSpeechNotice(`Ralat mikrofon (${event.error}). Cuba lagi.`);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // Submit compressed image, prompt, and dialect to POST /api/analyze
  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!imageData) {
      setError('Sila ambil gambar atau muat naik imej objek harian terlebih dahulu.');
      return;
    }

    setLoading(true);
    setError('');
    setSelectedOption(null);
    setUserQuizNotes('');
    setShowQuizFeedback(false);

    try {
      const formData = new FormData();
      if (imageData.blob) {
        formData.append('image', imageData.blob, 'kampunglab-compressed.jpg');
      }
      formData.append('image_base64', imageData.dataUrl);
      formData.append(
        'prompt',
        prompt.trim() || 'Terangkan konsep STEM bagi objek dalam gambar ini.'
      );
      formData.append('language', language);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const rawText = await response.text();
      // Calculate exact JSON payload size in KB received from server
      const byteSize = new Blob([rawText]).size;
      const kbSize = Number((byteSize / 1024).toFixed(2));
      setPayloadKb(kbSize);
      setProviderUsed(response.headers.get('X-KampungLab-Provider') || 'ai');

      let parsedJson;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        throw new Error('Respons daripada pelayan bukan format JSON yang sah.');
      }

      if (!response.ok) {
        throw new Error(
          parsedJson?.detail || 'Gagal menganalisis imej bersama Cikgu KampungLab.'
        );
      }

      setResult(parsedJson);
    } catch (err) {
      setError(err.message || 'Ralat rangkaian semasa menghubungi pelayan.');
    } finally {
      setLoading(false);
    }
  };

  const savingsPercent =
    imageData && imageData.originalKb > 0
      ? Math.max(
          0,
          Math.round(
            ((imageData.originalKb - imageData.compressedKb) /
              imageData.originalKb) *
              100
          )
        )
      : 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 pb-12">
      {/* Top Bar with Low-Bandwidth Mode Active Badge */}
      <header className="sticky top-0 z-30 bg-emerald-800 text-white shadow-md">
        <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-sm border border-emerald-400/40 shadow-inner">
              KL
            </div>
            <div>
              <h1 className="font-bold text-base leading-tight tracking-tight">
                KampungLab <span className="text-emerald-200 font-normal text-xs">PWA</span>
              </h1>
              <p className="text-[11px] text-emerald-100/90 leading-none">
                Cikgu KampungLab • STEM Luar Bandar
              </p>
            </div>
          </div>

          {/* Required Badge: Low-Bandwidth Mode Active + JSON Payload KB */}
          <div
            className="inline-flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-400/40 rounded-full px-2.5 py-1 text-[11px] font-medium text-emerald-100"
            title="Saiz payload JSON yang diterima daripada pelayan"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Low-Bandwidth Mode Active</span>
            <span className="font-bold text-amber-300 ml-0.5">
              • {payloadKb.toFixed(2)} KB
            </span>
          </div>
        </div>
      </header>

      {/* Main Mobile-First Container */}
      <main className="w-full max-w-md mx-auto px-4 pt-4 space-y-4 flex-1">
        {/* Intro Card */}
        <section className="bg-gradient-to-br from-emerald-700 to-teal-800 rounded-2xl p-4 text-white shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-white/15 px-2 py-0.5 rounded-full mb-1.5">
                Pembelajaran Kontekstual
              </span>
              <h2 className="text-lg font-bold leading-snug">
                Belajar Sains, Matematik &amp; IT Daripada Objek Sekeliling!
              </h2>
              <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                Ambil gambar objek harian (daun, basikal, batu, alatan rumah), pilih bahasa/dialek, dan tanya Cikgu KampungLab.
              </p>
            </div>
          </div>
        </section>

        {/* Form Card */}
        <form
          onSubmit={handleAnalyze}
          className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-4"
        >
          {/* Step 1: Language / Dialect Dropdown */}
          <div>
            <label
              htmlFor="language-select"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
            >
              1. Pilih Bahasa / Dialek
            </label>
            <select
              id="language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Camera / Upload Image with HTML5 Canvas Compression */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                2. Kamera / Muat Naik Imej Objek
              </label>
              <span className="text-[11px] text-emerald-700 font-medium">
                Auto-Kompres &le;600px (JPEG 0.6)
              </span>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-semibold text-xs shadow-sm transition"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <circle cx="12" cy="13" r="3" />
                </svg>
                <span>Ambil Gambar</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-semibold text-xs border border-slate-300 transition"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                <span>Pilih Fail / Galeri</span>
              </button>
            </div>

            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleLoadSampleImage}
                className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800 underline"
              >
                Tiada gambar? Guna imej contoh objek harian (Daun &amp; Cahaya)
              </button>
            </div>

            {/* HTML5 Canvas Compressed Image Preview & Size Indicator */}
            {compressing && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                <span>Mengompres imej dengan HTML5 Canvas (maks 600px, JPEG 0.6)...</span>
              </div>
            )}

            {imageData && !compressing && (
              <div className="mt-3 rounded-xl overflow-hidden border border-emerald-200 bg-emerald-50/50">
                <div className="relative bg-slate-900/5">
                  <img
                    src={imageData.dataUrl}
                    alt="Pratonton imej terkumpul"
                    className="w-full max-h-48 object-contain mx-auto"
                  />
                </div>
                <div className="px-3 py-2 bg-emerald-100/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-semibold text-emerald-950">
                    Saiz Selepas Dikompres:{' '}
                    <span className="inline-block bg-emerald-700 text-white px-2 py-0.5 rounded-md font-bold">
                      {imageData.compressedKb} KB
                    </span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Asal: {imageData.originalKb} KB ({imageData.width}&times;{imageData.height}px
                    {savingsPercent > 0 ? ` • Jimat ${savingsPercent}%` : ''})
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Question Prompt + Web Speech API Voice Button */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="prompt-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
              >
                3. Soalan Untuk Cikgu KampungLab
              </label>

              {/* Voice Input Button (webkitSpeechRecognition ms-MY) */}
              <button
                type="button"
                onClick={handleToggleVoiceInput}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                  isListening
                    ? 'bg-red-600 text-white animate-pulse'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                }`}
                title="Input Suara Bahasa Melayu (ms-MY)"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"
                  />
                </svg>
                <span>{isListening ? 'Berhenti Rakam' : 'Input Suara (ms-MY)'}</span>
              </button>
            </div>

            <textarea
              id="prompt-input"
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Contoh: Cikgu, bagaimana daun ini membuat makanan?"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />

            {speechNotice && (
              <p className="mt-1 text-[11px] text-emerald-700 font-medium">
                {speechNotice}
              </p>
            )}

            {/* Quick Prompt Chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setPrompt(q)}
                  className="text-[11px] bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-600 px-2.5 py-1 rounded-lg border border-slate-200 transition text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || compressing}
            className="w-full py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-emerald-900/10 flex items-center justify-center gap-2 transition"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Cikgu KampungLab Sedang Menganalisis...</span>
              </>
            ) : (
              <>
                <span>Tanya Cikgu KampungLab</span>
                <span className="text-xs font-normal text-emerald-200">
                  ({language})
                </span>
              </>
            )}
          </button>
        </form>

        {/* Results Section: SVG Visual + Explanation + Interactive Quiz */}
        {result && (
          <section className="space-y-4 animate-fadeIn">
            {/* Title & Metadata Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-emerald-200">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                  Dialek: {language}
                </span>
                <span className="text-[11px] text-slate-500">
                  Saiz Respons JSON: <strong>{payloadKb.toFixed(2)} KB</strong>
                </span>
              </div>

              <h2 className="text-lg font-extrabold text-slate-900 leading-snug">
                {result.title}
              </h2>

              {/* Responsive Safe SVG Visual Container */}
              <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 overflow-hidden">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Ilustrasi &amp; Animasi Konsep STEM (SVG)</span>
                  <span className="text-emerald-700">Vektor Ringan</span>
                </div>
                <div
                  className="svg-stage w-full flex items-center justify-center"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeSvgCode(result.svg_code),
                  }}
                />
              </div>

              {/* Explanation Text */}
              <div className="mt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-1.5">
                  Penerangan Cikgu KampungLab
                </h3>
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-100">
                  {result.explanation}
                </div>
              </div>
            </div>

            {/* Interactive Quiz Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900">
                  Kuiz Uji Minda
                </span>
                <span className="text-xs text-slate-500">
                  Uji kefahaman konsep STEM
                </span>
              </div>

              <p className="text-sm font-bold text-slate-900 mb-3">
                {result.quiz_question}
              </p>

              {Array.isArray(result.quiz_options) &&
              result.quiz_options.length > 0 ? (
                <div className="space-y-2">
                  {result.quiz_options.map((option, idx) => {
                    const isSelected = selectedOption === option;
                    const isCorrect =
                      result.quiz_answer && option === result.quiz_answer;

                    let btnStyle =
                      'border-slate-200 bg-slate-50 hover:bg-emerald-50 text-slate-800';
                    if (showQuizFeedback && isSelected) {
                      btnStyle = isCorrect
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-amber-500 bg-amber-50 text-amber-900 font-semibold';
                    } else if (isSelected) {
                      btnStyle =
                        'border-emerald-600 bg-emerald-50/80 text-emerald-900 font-semibold';
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelectedOption(option);
                          setShowQuizFeedback(true);
                        }}
                        className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-xs transition flex items-start gap-2.5 ${btnStyle}`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white border border-slate-300 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className="flex-1">{option}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={userQuizNotes}
                    onChange={(e) => setUserQuizNotes(e.target.value)}
                    placeholder="Taip jawapan ringkas anda di sini..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowQuizFeedback(true)}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs"
                  >
                    Semak Jawapan
                  </button>
                </div>
              )}

              {showQuizFeedback && (
                <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                  {selectedOption && result.quiz_answer && (
                    <p className="font-bold">
                      {selectedOption === result.quiz_answer
                        ? '✅ Tahniah! Jawapan anda tepat sekali!'
                        : `💡 Jawapan Tepat: ${result.quiz_answer}`}
                    </p>
                  )}
                  {result.quiz_explanation && (
                    <p className="text-emerald-800 leading-relaxed">
                      {result.quiz_explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-md mx-auto px-4 pt-6 text-center text-[11px] text-slate-400">
        KampungLab PWA • Direka untuk akses jalur lebar rendah &amp; Google Cloud Run
      </footer>
    </div>
  );
}
