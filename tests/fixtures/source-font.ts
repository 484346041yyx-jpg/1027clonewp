/** Synthetic bounded table directory; not a renderable typography fixture. */
export function sourceFontFixture() {
  const tags = ['head','maxp','cmap','name','glyf','loca'], bytes = Buffer.alloc(12 + tags.length * 20);
  bytes.writeUInt32BE(0x00010000,0);bytes.writeUInt16BE(tags.length,4);
  tags.forEach((tag,i)=>{const p=12+16*i;bytes.write(tag,p,'ascii');bytes.writeUInt32BE(12+tags.length*16+i*4,p+8);bytes.writeUInt32BE(4,p+12)});
  return bytes;
}
