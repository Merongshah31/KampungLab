/**
 * Sanitizes raw SVG markup from LLM so it can be rendered safely in React
 * while preserving internal CSS <style> and @keyframes animations.
 */

const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'foreignObject'];

export function sanitizeSvgCode(rawSvg) {
  if (!rawSvg || typeof rawSvg !== 'string') {
    return '';
  }

  // Extract <svg>...</svg> block if surrounded by markdown backticks or text
  const match = rawSvg.match(/<svg[\s\S]*?<\/svg>/i);
  const svgCandidate = match ? match[0] : rawSvg.trim();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgCandidate, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');
    const svgEl = doc.querySelector('svg');

    if (parserError || !svgEl) {
      return fallbackSvg();
    }

    // Remove dangerous elements
    FORBIDDEN_TAGS.forEach((tag) => {
      svgEl.querySelectorAll(tag).forEach((node) => node.remove());
    });

    // Remove inline event handlers (onload, onclick, onerror, etc.) and javascript: hrefs
    const allElements = [svgEl, ...svgEl.querySelectorAll('*')];
    allElements.forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.toLowerCase().trim();
        if (name.startsWith('on') || value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Ensure responsive attributes
    if (!svgEl.getAttribute('viewBox')) {
      const w = svgEl.getAttribute('width') || '400';
      const h = svgEl.getAttribute('height') || '250';
      svgEl.setAttribute('viewBox', `0 0 ${parseInt(w, 10) || 400} ${parseInt(h, 10) || 250}`);
    }
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('class', 'w-full h-auto max-h-72 mx-auto block');

    return svgEl.outerHTML;
  } catch {
    return fallbackSvg();
  }
}

function fallbackSvg() {
  return `<svg viewBox="0 0 400 220" class="w-full h-auto max-h-72 mx-auto block" xmlns="http://www.w3.org/2000/svg">
    <style>
      .orb { animation: floatOrb 2.4s ease-in-out infinite; transform-origin: center; }
      @keyframes floatOrb { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(5px); } }
    </style>
    <rect width="400" height="220" rx="16" fill="#ecfdf5" />
    <circle cx="200" cy="105" r="46" fill="#10b981" class="orb" />
    <text x="200" y="110" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="14" font-weight="bold">Visual STEM KampungLab</text>
  </svg>`;
}
