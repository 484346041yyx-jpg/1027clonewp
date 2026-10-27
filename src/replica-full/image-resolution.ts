import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { nativeImageSlots } from './native-image-policy.js';
import { walkNative44, type Native44Program } from '../native44/types.js';
import type { Native44Asset } from '../native44/media.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';

/** WordPress size variants are candidates only when their original URL is identical. */
export function sourceImageFamily(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) return;
    if (!/\.(?:avif|jpe?g|png|webp)$/i.test(url.pathname)) return;
    url.pathname = url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/i, '');
    return url.href;
  } catch { return; }
}

export interface ImageResolutionReplacement {
  componentKey: string; settingPath: string; beforeAssetKey: string; afterAssetKey: string;
  displayedWidth: number; displayedHeight: number; beforeDensity: number; afterDensity: number;
}
export interface DirectImageSlot { componentKey: string; assetKey: string }

/** Runs before a new merged program is frozen. Existing v1 tasks never call it. */
export async function resolveNativeImageResolution(input: {
  program: Native44Program; sourceFacts: SourceFactsV2; assets: Native44Asset[];
  readAsset: (asset: Native44Asset) => Promise<Buffer>;
}): Promise<{ program: Native44Program; replacements: ImageResolutionReplacement[]; directImageSlots: DirectImageSlot[] }> {
  const program = structuredClone(input.program), nodes = new Map(walkNative44(program.blocks).map(node => [node.key, node]));
  const assets = new Map(input.assets.map(asset => [asset.key, asset]));
  const groups = new Map<string, Native44Asset[]>();
  for (const asset of input.assets) {
    const family = sourceImageFamily(asset.sourceUrl); if (!family) continue;
    groups.set(family, [...(groups.get(family) ?? []), asset]);
  }
  const dimensions = new Map<string, Promise<{ width: number; height: number }>>();
  const size = (asset: Native44Asset) => {
    if (!dimensions.has(asset.key)) dimensions.set(asset.key, (async () => {
      const bytes = await input.readAsset(asset);
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error(`image_resolution_asset_changed:${asset.key}`);
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height) throw Error(`image_resolution_dimensions_missing:${asset.key}`);
      return { width: metadata.width, height: metadata.height };
    })());
    return dimensions.get(asset.key)!;
  };
  const replacements: ImageResolutionReplacement[] = [];
  const directImageSlots: DirectImageSlot[] = [];
  for (const slot of nativeImageSlots(program)) {
    const node = nodes.get(slot.componentKey), current = assets.get(slot.assetKey);
    if (!node || !current) continue;
    const family = sourceImageFamily(current.sourceUrl); if (!family) continue;
    const measured = (node.sourceFactIds ?? []).map(id => input.sourceFacts.facts[id]).filter(fact => {
      if (fact?.kind !== 'media') return false;
      const value = fact.value as { resource?: { url?: string }; layout?: { rect?: { width?: number; height?: number } } };
      return sourceImageFamily(value.resource?.url ?? '') === family && Number(value.layout?.rect?.width) > 0 && Number(value.layout?.rect?.height) > 0;
    });
    if (!measured.length) continue;
    const displayedWidth = Math.max(...measured.map(fact => Number((fact.value as any).layout.rect.width)));
    const displayedHeight = Math.max(...measured.map(fact => Number((fact.value as any).layout.rect.height)));
    if (displayedWidth < 80 || displayedHeight < 80) continue;
    const density = async (asset: Native44Asset) => {
      const dimensions = await size(asset);
      return Math.min(dimensions.width / displayedWidth, dimensions.height / displayedHeight);
    };
    const beforeDensity = await density(current);
    let selected = current;
    if (beforeDensity < 0.85) {
      const candidates = await Promise.all((groups.get(family) ?? []).map(async asset => ({ asset, density: await density(asset) })));
      candidates.sort((a, b) => a.density - b.density || a.asset.key.localeCompare(b.asset.key));
      const chosen = candidates.find(row => row.density >= 1.5) ?? candidates.at(-1);
      const originalBackground = measured.every(fact => {
        const value = fact.value as { kind?: string; resource?: { url?: string } };
        return value.kind === 'background' && value.resource?.url === current.sourceUrl;
      });
      if ((!chosen || chosen.density < 0.95 || chosen.density <= beforeDensity) && !originalBackground) {
        throw Error(`image_resolution_no_adequate_source:${slot.componentKey}:${slot.settingPath}:${Math.round(displayedWidth)}x${Math.round(displayedHeight)}`);
      }
      if (chosen && chosen.density >= 0.95 && chosen.density > beforeDensity) {
        selected = chosen.asset;
        const replace = (root: unknown): boolean => {
          let value: any = root;
          for (const part of slot.settingPath.split('.')) value = value?.[part];
          if (!value || typeof value !== 'object' || value.$asset !== current.key) return false;
          value.$asset = selected.key; return true;
        };
        if (!replace(node.settings) && !('widgetSettings' in node && replace(node.widgetSettings))) throw Error(`image_resolution_slot_changed:${slot.componentKey}:${slot.settingPath}`);
        replacements.push({ componentKey: slot.componentKey, settingPath: slot.settingPath, beforeAssetKey: current.key, afterAssetKey: selected.key, displayedWidth, displayedHeight, beforeDensity, afterDensity: chosen.density });
      }
    }
    // WordPress srcset chooses by rendered width. With a differently shaped
    // image and object-fit crop, the browser can choose a narrow derivative
    // that is then enlarged by the crop. The Woodmart native image widget can
    // use its registered media URL directly while remaining editable.
    if (node.kind === 'native' && node.widgetType === 'wd_image_or_svg' && slot.settingPath === 'image') {
      const selectedSize = await size(selected);
      const imageRatio = selectedSize.width / selectedSize.height, displayRatio = displayedWidth / displayedHeight;
      if (Math.max(imageRatio / displayRatio, displayRatio / imageRatio) > 1.15) directImageSlots.push({ componentKey: slot.componentKey, assetKey: selected.key });
    }
  }
  return { program, replacements, directImageSlots };
}
