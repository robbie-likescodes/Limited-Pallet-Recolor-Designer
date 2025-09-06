// Small procedural patterns, returns function (x,y)->0..1 coverage for ink A,
// or returns {fn, params} used by mapper to composite multiple inks.
export function makePattern(type='checker', params={}){
  switch(type){
    case 'checker': {
      const s = params.size ?? 2; // cell size in px
      return (x,y)=> ((Math.floor(x/s)+Math.floor(y/s))%2) ? 1 : 0;
    }
    case 'bayer2': {
      // 2x2 ordered dither matrix
      const M=[[0,2],[3,1]]; const div=4; const s=2;
      return (x,y,thr=0.5)=> ((M[y%s][x%s]/div) < thr) ? 1 : 0;
    }
    case 'bayer4': {
      const M=[
        [ 0, 8, 2,10],
        [12, 4,14, 6],
        [ 3,11, 1, 9],
        [15, 7,13, 5]
      ]; const div=16, s=4;
      return (x,y,thr=0.5)=> ((M[y%s][x%s]/div) < thr) ? 1 : 0;
    }
    case 'stripes': {
      const w = params.width ?? 4;
      return (x,y)=> (Math.floor(x/w)%2) ? 1 : 0;
    }
    case 'stipple': {
      const density = params.density ?? 0.5; // base
      const j = params.jitter ?? 0.15;
      return ()=> (Math.random() < Math.max(0, Math.min(1, density + (Math.random()*2-1)*j))) ? 1 : 0;
    }
    default: return ()=>1;
  }
}

