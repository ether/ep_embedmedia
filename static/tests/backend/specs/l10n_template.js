'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..', '..', '..', '..');
const editbarPath = path.join(pluginRoot, 'templates', 'editbarButtons.ejs');

describe(__filename, function () {
  it('editbar button does not attach data-l10n-id to elements with child content (#11)',
      function () {
        // html10n emits
        //   "Unexpected error: could not translate element content for key ..."
        // when an element has a `data-l10n-id` that replaces its text content
        // *and* it has structural child elements. Every `data-l10n-id` in this
        // template must therefore either live on a leaf element with no child
        // nodes, or be paired with `data-l10n-attr` so the translation targets
        // an attribute (e.g. `title`, `aria-label`) rather than innerHTML.
        const src = fs.readFileSync(editbarPath, 'utf8');
        const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)([^>]*\bdata-l10n-id="[^"]+"[^>]*)>/g;
        const matches = [];
        let m;
        while ((m = tagRe.exec(src)) !== null) matches.push({tag: m[1], attrs: m[2], index: m.index});
        assert(matches.length > 0, 'expected at least one data-l10n-id tag in editbarButtons.ejs');
        for (const match of matches) {
          const hasL10nAttr = /data-l10n-attr="[^"]+"/.test(match.attrs);
          if (hasL10nAttr) continue;
          // Element translates innerHTML -> must not contain any child tags.
          // Find the index of the matching closing tag and inspect what's in between.
          const open = src.indexOf('>', match.index) + 1;
          const closeRe = new RegExp(`</${match.tag}\\s*>`, 'g');
          closeRe.lastIndex = open;
          const close = closeRe.exec(src);
          assert(close, `unterminated <${match.tag}> in editbarButtons.ejs`);
          const body = src.slice(open, close.index);
          assert(!/<[a-zA-Z]/.test(body),
              `<${match.tag}> has data-l10n-id replacing innerHTML but contains child elements: ${body}`);
        }
      });
});
