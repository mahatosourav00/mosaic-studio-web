// Write the print resolution (DPI) into PNG and JPEG files so print shops get the right size.
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export async function withDpi(blob, dpi) {
  if (!dpi) return blob;
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === "image/png" && buf.length > 33) {
    const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);                       // length 9, "pHYs"
    const ppm = Math.round(dpi / 0.0254);
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;                        // pixels per metre
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(buf.length + 21);
    out.set(buf.subarray(0, 33)); out.set(chunk, 33); out.set(buf.subarray(33), 54);   // right after IHDR
    return new Blob([out], { type: "image/png" });
  }
  if (blob.type === "image/jpeg" && buf[2] === 0xff && buf[3] === 0xe0 && buf[6] === 0x4a) {   // JFIF header present
    buf[13] = 1; buf[14] = dpi >> 8; buf[15] = dpi & 255; buf[16] = dpi >> 8; buf[17] = dpi & 255;
    return new Blob([buf], { type: "image/jpeg" });
  }
  return blob;
}
