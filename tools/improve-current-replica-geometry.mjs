import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root='D:/cloneWP';
const job=path.join(root,'references','reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb');
const read=async name=>JSON.parse(await readFile(path.join(job,name),'utf8'));
const program=JSON.parse(await readFile(path.join(root,'runs','2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75','native-program.json'),'utf8'));
const contract=await read('block-contract.json'),manifest=await read('asset-manifest.json');
const packets=Object.fromEntries(await Promise.all(['desktop','tablet','mobile'].map(async name=>[name,await read(`reference/${name}.json`)])));
const staticBlocks=new Set(['header','promo','deals-by-pet','bogo','shop-way','services','footer']);
const ids=Object.keys(packets),media={desktop:'',tablet:'@media(max-width:1024px)',mobile:'@media(max-width:767px)'};
const cleanText=value=>String(value??'').replace(/\s+/g,' ').trim();
const allNodes=(nodes)=>nodes.flatMap(node=>[node,...allNodes(node.children??[])]);
const sourceAssets=new Map(manifest.assets.map(asset=>[asset.key,asset]));
const observedAtoms=id=>{const map=new Map();for(const packet of Object.values(packets))for(const atom of packet.blocks.find(block=>block.id===id)?.textAtoms??[]){if(atom.text?.trim()&&!map.has(`${atom.selector}\u0000${atom.text}`))map.set(`${atom.selector}\u0000${atom.text}`,atom);}return [...map.values()];};
const valid=(rect,block)=>rect&&rect.width>1&&rect.height>1&&rect.x+rect.width>block.rect.x+1&&rect.x<block.rect.x+block.rect.width-1&&rect.y+rect.height>block.rect.y+1&&rect.y<block.rect.y+block.rect.height-1;
const cssFor=(viewStyles)=>ids.map(name=>media[name]?`${media[name]}{selector{${viewStyles[name]??'display:none!important;'}}}`:`selector{${viewStyles[name]??'display:none!important;'}}`).join('').replaceAll('!important','').replaceAll('box-sizing:border-box;','');
const geom=(rect,block)=>`display:block!important;position:absolute!important;left:${((rect.x-block.rect.x)/block.rect.width*100).toFixed(3)}%!important;top:${Math.max(0,rect.y-block.rect.y).toFixed(2)}px!important;width:${(rect.width/block.rect.width*100).toFixed(3)}%!important;min-height:${rect.height.toFixed(2)}px!important;max-width:none!important;margin:0!important;padding:0!important;`;
for(let index=0;index<program.blocks.length;index++){
  const spec=program.blocks[index],id=spec.sourceBlockId,rootNode=program.elements[index],nodes=allNodes([rootNode]),atoms=observedAtoms(id),texts=contract.blocks[index].texts;
  if(staticBlocks.has(id)){
    const preservedCarouselChildren=id==='header'?new Set(allNodes(nodes.find(node=>node.key==='header-carousel')?.children??[]).map(node=>node.key)):new Set();
    const rootCSS={};for(const name of ids){const block=packets[name].blocks.find(block=>block.id===id);rootCSS[name]=`position:relative!important;display:block!important;min-height:${block.rect.height.toFixed(2)}px!important;height:${block.rect.height.toFixed(2)}px!important;overflow:hidden!important;box-sizing:border-box!important;padding:0!important;margin:0!important;`;}
    rootNode.settings.custom_css=cssFor(rootCSS);
    if(id==='promo')rootNode.settings.background_color='#3f748d';
    for(const node of nodes){
      if(node===rootNode)continue;
      if(preservedCarouselChildren.has(node.key))continue;
      if(node.type==='nested-carousel'){node.settings.custom_css=id==='header'?'selector{position:absolute!important;left:0!important;top:75px!important;width:100%!important;height:45px!important;overflow:hidden!important;}':'selector{display:none!important;}';continue;}
      if(node.type==='container'){
        if(node.key===`${id}-content`){node.settings.custom_css=cssFor(Object.fromEntries(ids.map(name=>[name,'position:relative!important;display:block!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;padding:0!important;'])));}
        else node.settings.custom_css=cssFor(Object.fromEntries(ids.map(name=>[name,'display:contents!important;position:static!important;'])));
        continue;
      }
      if(node.type==='heading'){
        const textIndex=texts.findIndex(entry=>entry.id===node.key),atom=atoms[textIndex],rules={};
        for(const name of ids){const block=packets[name].blocks.find(block=>block.id===id),match=block.textAtoms?.find(row=>row.selector===atom?.selector&&row.text===atom?.text&&valid(row.rect,block));rules[name]=match?geom(match.rect,block):'display:none!important;';}
        node.settings.custom_css=cssFor(rules);
      }
      if(node.type==='image'){
        const asset=sourceAssets.get(node.settings.image?.$asset),rules={};
        for(const name of ids){const block=packets[name].blocks.find(block=>block.id===id),match=block.images?.find(row=>row.url===asset?.sourceUrl&&valid(row.rect,block));rules[name]=match?geom(match.rect,block):'display:none!important;';}
        node.settings.custom_css=cssFor(rules)+'selector img{width:100%;height:100%;object-fit:contain;}';
      }
    }
  }else{
    // Keep native carousel and product ownership. Suppress source text whose
    // measured source node was never active in any captured viewport.
    const carouselChildren=new Set(allNodes(nodes.find(node=>node.key===`${id}-carousel`)?.children??[]).map(node=>node.key));
    for(const node of nodes.filter(node=>node.type==='heading')){
      if(carouselChildren.has(node.key))continue;
      const textIndex=texts.findIndex(entry=>entry.id===node.key),atom=atoms[textIndex];
      if(!atom)continue;
      const everVisible=ids.some(name=>{const block=packets[name].blocks.find(block=>block.id===id);return block.textAtoms?.some(row=>row.selector===atom.selector&&row.text===atom.text&&valid(row.rect,block));});
      if(!everVisible)node.settings.custom_css='selector{display:none!important;}';
    }
    // Carousel images remain owned by their native slides; their media controls
    // must not be hidden while correcting separate static text placement.
  }
}
for(const node of allNodes(program.elements))if(typeof node.settings.custom_css==='string')node.settings.custom_css=node.settings.custom_css.replaceAll('!important','');
const out=path.join(job,'program-geometry-review.json');
await writeFile(out,JSON.stringify(program,null,2)+'\n');
process.stdout.write(JSON.stringify({program:out,nativeNodes:allNodes(program.elements).length})+'\n');
