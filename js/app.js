import { setEls, State, bus } from './state.js';
import { handleFile } from './io/files.js';
import { loadPMS } from './color/palette.js';
import { wireControls } from './ui/controls.js';
import { initFullscreen } from './editor/fullscreen.js';
import { enableEyedrop } from './editor/eyedropper.js';
import { enableLasso } from './editor/lasso.js';
import { toast } from './ui/toasts.js';

function $(id){ return document.getElementById(id); }

window.addEventListener('DOMContentLoaded', async ()=>{
  const els={
    // image
    fileInput: $('fileInput'), cameraInput: $('cameraInput'), pasteBtn:$('pasteBtn'), resetBtn:$('resetBtn'),
    maxW:$('maxW'), keepFullRes:$('keepFullRes'), sharpenEdges:$('sharpenEdges'),
    srcCanvas:$('srcCanvas'), outCanvas:$('outCanvas'),

    // palette
    addColor:$('addColor'), clearColors:$('clearColors'), loadExample:$('loadExample'),
    paletteList:$('paletteList'),
    wChroma:$('wChroma'), wLight:$('wLight'), wChromaOut:$('wChromaOut'), wLightOut:$('wLightOut'),
    useDither:$('useDither'), bgMode:$('bgMode'),
    applyBtn:$('applyBtn'), downloadBtn:$('downloadBtn'),

    // Restricted + suggestions
    btnOpenRestricted: $('btnOpenRestricted'),
    restrictedPaletteList: $('restrictedPaletteList'),
    btnSuggest: $('btnSuggest'),
    suggestList: $('suggestList'),

    // Manual replacement
    manualTarget: $('manualTarget'),
    manualMix: $('manualMix'),
    manualApply: $('manualApply'),

    // Regenerate + exports
    btnRegenerate: $('btnRegenerate'),
    btnExportSVG: $('btnExportSVG'),
    exportReport: $('exportReport'),

    // Editor
    openEditor:$('openEditor'), editorOverlay:$('editorOverlay'), editorDone:$('editorDone'),
    editCanvas:$('editCanvas'), editOverlay:$('editOverlay'),
    eyeSwatch:$('eyeSwatch'), eyeHex:$('eyeHex'), eyeAdd:$('eyeAdd'), eyeCancel:$('eyeCancel'),
    lassoChecks:$('lassoChecks'), lassoSave:$('lassoSave'), lassoClear:$('lassoClear'),

    // Codes
    codeList:$('codeList'),
  };
  setEls(els);

  // Wire controls/UI
  wireControls(els);
  initFullscreen(els);
  enableEyedrop(els);
  enableLasso(els);

  // File inputs
  els.fileInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });
  els.cameraInput?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });

  // Simple paste button (best-effort)
  els.pasteBtn?.addEventListener('click', async ()=>{
    if(!navigator.clipboard?.read) { alert('Clipboard read not supported here'); return; }
    try{
      const items=await navigator.clipboard.read();
      for(const it of items){ for(const t of it.types){ if(t.startsWith('image/')){ const blob=await it.getType(t); await handleFile(blob); return; } } }
      alert('No image in clipboard');
    }catch{ alert('Clipboard read failed'); }
  });

  // Reset
  els.resetBtn?.addEventListener('click', ()=>{
    if(!State.original.bitmap) return;
    // Rerender preview and clear mapping
    const e=new Event('image:loaded'); bus.emit('image:loaded');
  });

  // Load PMS library for codes/report
  await loadPMS('./assets/pms_solid_coated.json');

  toast('Ready — load an image to begin');
});

