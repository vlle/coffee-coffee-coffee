import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const OUTPUT_DIR = path.join(ROOT, 'public', 'icons')

fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const makeChunk = (type, data) => {
  const typeBuf = Buffer.from(type)
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  const crc = crc32(Buffer.concat([typeBuf, data]))
  crcBuf.writeUInt32BE(crc, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

const writePNG = (filePath, size) => {
  const bg = [253, 251, 247, 255]
  const accent = [139, 90, 43, 255]
  const border = [44, 44, 44, 255]
  const data = Buffer.alloc((size * 4 + 1) * size)

  const center = size / 2
  const radius = size * 0.32
  const inner = size * 0.24
  const borderRadius = size * 0.38

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    data[rowStart] = 0
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - center
      const dy = y + 0.5 - center
      const dist = Math.hypot(dx, dy)
      let color = bg
      if (dist <= borderRadius) color = border
      if (dist <= radius) color = accent
      if (dist <= inner) color = bg
      const idx = rowStart + 1 + x * 4
      data[idx] = color[0]
      data[idx + 1] = color[1]
      data[idx + 2] = color[2]
      data[idx + 3] = color[3]
    }
  }

  const compressed = zlib.deflateSync(data, { level: 9 })

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]

  const png = Buffer.concat([signature, ...chunks])
  fs.writeFileSync(filePath, png)
}

writePNG(path.join(OUTPUT_DIR, 'icon-192.png'), 192)
writePNG(path.join(OUTPUT_DIR, 'icon-512.png'), 512)

console.log('Icons generated in', OUTPUT_DIR)
