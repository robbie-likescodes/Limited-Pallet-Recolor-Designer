// imagetracer-loader.js
// Ensures ImageTracer is loaded from your GitHub Pages fork before use

async function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}

// Replace with the exact URL from your GitHub Pages
const IMAGETRACER_URL = "https://robbie-likescodes.github.io/imagetracerjs/imagetracer_v1.2.6.js";

export async function ensureImageTracerLoaded() {
  if (window.ImageTracer) return; // Already loaded
  await loadScript(IMAGETRACER_URL);

  if (!window.ImageTracer) {
    throw new Error("ImageTracer failed to load from " + IMAGETRACER_URL);
  }
}
