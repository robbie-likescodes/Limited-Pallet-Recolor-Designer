// imagetracer-loader.js
// Loads your forked ImageTracer from GitHub Pages on demand.
// Replace the URL below only if your repo or path changes.

export async function ensureImageTracerLoaded() {
  if (window.ImageTracer && typeof window.ImageTracer.imageToSVG === 'function') return;

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://robbie-likescodes.github.io/imagetracerjs/imagetracer_v1.2.6.js';
    s.async = true;
    s.onload = () => {
      if (window.ImageTracer) resolve();
      else reject(new Error('ImageTracer loaded but not found on window.'));
    };
    s.onerror = () => reject(new Error('Failed to load imagetracer_v1.2.6.js from GitHub Pages.'));
    document.head.appendChild(s);
  });
}
