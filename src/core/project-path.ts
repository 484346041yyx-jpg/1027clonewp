import path from 'node:path';

export function insideProject(root: string, value: string): string {
  const resolved = path.resolve(root, value), relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Design and assets must stay inside the project');
  return resolved;
}
