import { walkNative44, type Native44Component } from '../native44/types.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import type { PreparationSection } from './types.js';
import { createSectionRelationships } from './section-relationships.js';
import { PRESENTATION_PROPERTIES, sourcePresentation } from './presentation.js';

const paintKeys = [...new Set(Object.values(PRESENTATION_PROPERTIES).flat())];

export function createProductionGuide(source: SourceFactsV2, sections: PreparationSection[], blocks?: Native44Component[]) {
  const layouts = new Map(Object.values(source.facts).filter(fact => fact.kind === 'layout').map(fact => [`${fact.snapshotId}:${fact.nodeId}`, fact]));
  return {
    version: 3, kind: 'source-production-guide',
    instructions: 'Preserve the complete source inventory before selecting the enabled 44 components. Plan page > functional section > related groups > elements, then author outside-in. One section has one principal native container; internal groups own alignment, sizing and state changes. Source DOM groups and measured alignment are evidence candidates, not instructions to copy every wrapper or force equal heights. Use each viewport independently. Reproduce text wrapping through source font, content width and spacing; do not infer hard line breaks from line count. Set native container direction and sizing before supplemental CSS. Mapped means assigned in the program, not rendered or working. Unmapped facts remain visible work items and do not block progress.',
    stages: {
      collectAndPlan: ['Complete visible and hidden content, links, media and decorations before component selection.', 'Read section relationships and screenshots together; decide outer/content widths, group proportions, alignment, gaps, image fitting and state-dependent layout.', 'For every actual viewport use presentation properties, parent content offsets and line words; distinguish hard breaks, usable width and verified font from a line-count guess.', 'Investigate relevant default, hover, focus, pressed, selected, expanded, filled/error and scroll/motion states with their affected content; dismiss non-applicable candidates explicitly, never invent them.', 'Record unknowns and explicit content substitutions with their reason; never silently replace source copy or media to suit a query widget.'],
      author: ['Build the principal section container and related groups before leaf widgets; native layout first, scoped CSS second.', 'Assign each size, inset, margin, gap, alignment and state effect to one actual native container/control or scoped rule; parent offsets are results, not extra margins to add.', 'Compare actual widget defaults and conditional controls with the source: backgrounds, borders, icons, arrows, dots, active states and button widths.', 'Build compound fields, image/title overlays and selected-tab panels as groups. Account for popup clipping, stacking, closing and separate hover/focus/selected combinations. Never read or submit private form values.', 'During authoring inspect representative actual output for each distinct layout/control type; repair structural mistakes locally rather than accumulating end-of-page CSS patches.'],
      confirm: ['Compare stable actual content widths, loaded fonts/media and matching interaction states from page to section to group to element; requested viewport settings alone are not evidence.', 'Compare line words, logical-owner offsets, sizes, spacing and paint using compare-presentation; observations with missing mappings or mismatched viewports/states stay unverified, never visually passed.', 'Review representative repeated behavior plus distinct content and boundary states; do not hover every identical link. Random video frames and lazy hidden panels are not missing-design evidence.', 'Return only the affected section to planning or authoring when its relationships are wrong. Unknowns permit candidate progress, never a fabricated completion claim.'],
    },
    pageStructure: source.snapshots.map(snapshot => ({ snapshotId: snapshot.id, viewport: snapshot.viewport, screenshot: snapshot.screenshot, sections: sections.map(section => ({ key: section.key, layoutFactIds: section.sourceFactIds.filter(id => source.facts[id]?.snapshotId === snapshot.id && source.facts[id].kind === 'layout') })) })),
    sections: sections.map(section => {
      const root = blocks?.find(block => block.key === section.key);
      const components = root ? walkNative44([root]) : [];
      return {
        key: section.key,
        relationships: createSectionRelationships(source, section, blocks),
        viewports: source.snapshots.map(snapshot => {
          const facts = section.sourceFactIds.map(id => source.facts[id]).filter(fact => fact?.snapshotId === snapshot.id && fact.kind !== 'region');
          return {
            snapshotId: snapshot.id, viewport: snapshot.viewport, screenshot: snapshot.screenshot,
            visibleMediaCount: new Set(facts.filter(fact => fact.kind === 'media' && fact.value.visible === true).map(fact => fact.nodeId)).size,
            requirements: facts.map(fact => {
              const layout = (fact.kind === 'layout' ? fact.value : fact.value.layout) as Record<string, unknown> | undefined;
              const style = fact.value.style as Record<string, string> | undefined;
              const targets = components.filter(node => node.sourceFactIds?.includes(fact.id) && (fact.kind === 'layout' || node.kind !== 'composite')).map(node => ({ key: node.key, kind: node.kind, ...('widgetType' in node ? { widgetType: node.widgetType } : {}), ...(node.kind === 'composite' ? { nativeLayout: node.settings ?? {} } : {}) }));
              return {
                sourceFactId: fact.id, kind: fact.kind, nodeId: fact.nodeId, parentNodeId: snapshot.nodes[fact.nodeId]?.parentId ?? null,
                ...(layout ? { geometry: { rect: layout.rect, contentRect: layout.contentRect, padding: layout.padding, margin: layout.margin, gap: layout.gap, display: layout.display, direction: layout.direction, position: layout.position, maxWidth: layout.maxWidth } } : {}),
                ...(style ? { paint: Object.fromEntries(paintKeys.filter(key => style[key] !== undefined).map(key => [key, style[key]])) } : {}),
                ...(fact.kind === 'text' ? { text: fact.value.text, visible: fact.value.visible, ...(fact.value.lineCount === undefined ? {} : { lineCount: fact.value.lineCount }) } : {}),
                ...(fact.kind === 'media' ? { visible: fact.value.visible, mediaType: fact.value.kind } : {}),
                ...(fact.kind === 'interaction' ? { interaction: { kind: fact.value.kind, status: fact.value.status, controlType: (fact.value.details as Record<string, unknown> | undefined)?.type ?? null } } : {}),
                assignment: blocks === undefined ? 'awaiting-authoring' : targets.length ? 'mapped' : 'unmapped', targets,
                presentation: sourcePresentation(source, fact, components.filter(node => targets.some(target => target.key === node.key)), layouts),
              };
            }),
          };
        }),
      };
    }),
  };
}
