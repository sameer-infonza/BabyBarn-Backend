import bwipjs from 'bwip-js';

export async function renderCode128Png(text, { scale = 3, height = 12 } = {}) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: String(text),
    scale,
    height,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}
