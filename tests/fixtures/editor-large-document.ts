import type { EditorDocument } from '../../src/editor-completion/contract.js';

export function largeEditorDocument(): EditorDocument {
  const dimensions = () => ({ unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true });
  return {
    elements: Array.from({ length: 19 }, (_, sectionIndex) => ({
      id: `section_${sectionIndex}`, elType: 'container', isInner: false,
      settings: { content_width: 'full', flex_direction: 'column', padding: dimensions(), padding_mobile: dimensions() },
      elements: Array.from({ length: 20 }, (_, itemIndex) => ({
        id: `section_${sectionIndex}_text_${itemIndex}`, elType: 'widget', widgetType: 'text-editor', isInner: false,
        settings: {
          editor: `<p>Source-owned section ${sectionIndex}, text ${itemIndex}.</p>`,
          _margin: dimensions(), _padding: dimensions(), _margin_mobile: dimensions(), _padding_mobile: dimensions(),
          typography_typography: 'custom', typography_font_family: 'Source Sans Pro', typography_font_weight: '400',
          typography_font_size: { unit: 'px', size: 18, sizes: [] }, typography_font_size_mobile: { unit: 'px', size: 16, sizes: [] },
          typography_line_height: { unit: 'px', size: 28, sizes: [] }, typography_line_height_mobile: { unit: 'px', size: 24, sizes: [] },
          text_color: '#888888', align: 'start', align_mobile: 'start',
        },
        elements: [],
      })),
    })),
    settings: { custom_css: '.elementor-9 .source-owned{color:#888888}' },
  };
}
