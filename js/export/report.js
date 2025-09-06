import { State } from '../state.js';
import { rgbToHex } from '../color/space.js';
import { nearestPMS } from '../color/palette.js';

export function buildFinalReport(){
  // Final inks = restricted palette + any replacement outputs? (We report only inks actually rendered)
  const used = new Set();
  // Include all restricted inks
  State.restrictedPalette.forEach(rgb=> used.add(rgb.join(',')));
  // From replacements, add the ink indices actually used
  State.replacements.forEach(mix=>{
    mix.forEach(m=> used.add(State.restrictedPalette[m.inkIndex].join(',')));
  });

  const finalHexes = [...used].map(k=>{
    const [r,g,b]=k.split(',').map(n=>parseInt(n,10));
    return rgbToHex(r,g,b);
  });

  const lines = [];
  lines.push('Final inks (after replacements):');
  finalHexes.forEach((hx,i)=>{
    if(State.codeMode==='pms'){
      const p=nearestPMS(hx);
      lines.push(`${i+1}. ${p.name} (${p.hex})`);
    }else{
      lines.push(`${i+1}. ${hx}`);
    }
  });
  return lines.join('\n');
}

