/** Source font materialization is explicit and separate from image imports. */
export function validateSourceFontBytes(bytes: Buffer, mime: string): void {
  if (mime !== 'font/ttf' || bytes.length < 28 || bytes.length > 4 * 1024 * 1024 || bytes.readUInt32BE(0) !== 0x00010000) throw Error('source_font_truetype_required');
  const count = bytes.readUInt16BE(4);
  if (count < 1 || count > 128 || 12 + count * 16 > bytes.length) throw Error('source_font_table_directory');
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) {
    const entry = 12 + 16 * i, tag = bytes.toString('ascii', entry, entry + 4), offset = bytes.readUInt32BE(entry + 8), length = bytes.readUInt32BE(entry + 12);
    if (tags.has(tag) || offset < 12 + count * 16 || offset + length > bytes.length) throw Error('source_font_table_bounds');
    tags.add(tag);
  }
  if (!['head', 'maxp', 'cmap', 'name', 'glyf', 'loca'].every(tag => tags.has(tag))) throw Error('source_font_required_tables');
}
