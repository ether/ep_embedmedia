// From http://code.google.com/p/google-caja/source/browse/trunk/src/com/google/caja/plugin/html-sanitizer.js

// Copyright (C) 2006 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// yEmptyou may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview
 * An HTML sanitizer that can satisfy a variety of security policies.
 *
 * <p>
 * The HTML sanitizer is built around a SAX parser and HTML element and
 * attributes schemas.
 *
 * If the cssparser is loaded, inline styles are sanitized using the
 * css property and value schemas.  Else they are remove during
 * sanitization.
 *
 * If it exists, uses parseCssDeclarations, sanitizeCssProperty,  cssSchema
 *
 * @author mikesamuel@gmail.com
 * @author jasvir@gmail.com
 * \@requires html4
 * \@overrides window
 * \@provides html, html_sanitize
 */

/**
 * \@namespace
 */
var html = (function (html4) {
  // For closure compiler
  let parseCssDeclarations, sanitizeCssProperty, cssSchema;
  if ('undefined' !== typeof window) {
    parseCssDeclarations = window.parseCssDeclarations;
    sanitizeCssProperty = window.sanitizeCssProperty;
    cssSchema = window.cssSchema;
  }

  let lcase;
  // The below may not be true on browsers in the Turkish locale.
  if ('script' === 'SCRIPT'.toLowerCase()) {
    lcase = function (s) { return s.toLowerCase(); };
  } else {
    /**
     * {\@updoc
     * $ lcase('SCRIPT')
     * # 'script'
     * $ lcase('script')
     * # 'script'
     * }
     */
    lcase = function (s) {
      return s.replace(
          /[A-Z]/g,
          (ch) => String.fromCharCode(ch.charCodeAt(0) | 32));
    };
  }

  // The keys of this object must be 'quoted' or JSCompiler will mangle them!
  const ENTITIES = {
    lt: '<',
    gt: '>',
    amp: '&',
    nbsp: '\240',
    quot: '"',
    apos: '\'',
  };

  const decimalEscapeRe = /^#(\d+)$/;
  const hexEscapeRe = /^#x([0-9A-Fa-f]+)$/;
  /**
   * Decodes an HTML entity.
   *
   * {\@updoc
   * $ lookupEntity('lt')
   * # '<'
   * $ lookupEntity('GT')
   * # '>'
   * $ lookupEntity('amp')
   * # '&'
   * $ lookupEntity('nbsp')
   * # '\xA0'
   * $ lookupEntity('apos')
   * # "'"
   * $ lookupEntity('quot')
   * # '"'
   * $ lookupEntity('#xa')
   * # '\n'
   * $ lookupEntity('#10')
   * # '\n'
   * $ lookupEntity('#x0a')
   * # '\n'
   * $ lookupEntity('#010')
   * # '\n'
   * $ lookupEntity('#x00A')
   * # '\n'
   * $ lookupEntity('Pi')      // Known failure
   * # '\u03A0'
   * $ lookupEntity('pi')      // Known failure
   * # '\u03C0'
   * }
   *
   * @param {string} name the content between the '&' and the ';'.
   * @return {string} a single unicode code-point as a string.
   */
  function lookupEntity(name) {
    name = lcase(name); // TODO: &pi; is different from &Pi;
    if (ENTITIES.hasOwnProperty(name)) { return ENTITIES[name]; }
    let m = name.match(decimalEscapeRe);
    if (m) {
      return String.fromCharCode(parseInt(m[1], 10));
    } else if (m = name.match(hexEscapeRe)) {
      return String.fromCharCode(parseInt(m[1], 16));
    }
    return '';
  }

  function decodeOneEntity(_, name) {
    return lookupEntity(name);
  }

  const nulRe = /\0/g;
  function stripNULs(s) {
    return s.replace(nulRe, '');
  }

  const entityRe = /&(#\d+|#x[0-9A-Fa-f]+|\w+);/g;
  /**
   * The plain text of a chunk of HTML CDATA which possibly containing.
   *
   * {\@updoc
   * $ unescapeEntities('')
   * # ''
   * $ unescapeEntities('hello World!')
   * # 'hello World!'
   * $ unescapeEntities('1 &lt; 2 &amp;&AMP; 4 &gt; 3&#10;')
   * # '1 < 2 && 4 > 3\n'
   * $ unescapeEntities('&lt;&lt <- unfinished entity&gt;')
   * # '<&lt <- unfinished entity>'
   * $ unescapeEntities('/foo?bar=baz&copy=true')  // & often unescaped in URLS
   * # '/foo?bar=baz&copy=true'
   * $ unescapeEntities('pi=&pi;&#x3c0;, Pi=&Pi;\u03A0') // FIXME: known failure
   * # 'pi=\u03C0\u03c0, Pi=\u03A0\u03A0'
   * }
   *
   * @param {string} s a chunk of HTML CDATA.  It must not start or end inside
   *     an HTML entity.
   */
  function unescapeEntities(s) {
    return s.replace(entityRe, decodeOneEntity);
  }

  const ampRe = /&/g;
  const looseAmpRe = /&([^a-z#]|#(?:[^0-9x]|x(?:[^0-9a-f]|$)|$)|$)/gi;
  const ltRe = /[<]/g;
  const gtRe = />/g;
  const quotRe = /\"/g;

  /**
   * Escapes HTML special characters in attribute values.
   *
   * {\@updoc
   * $ escapeAttrib('')
   * # ''
   * $ escapeAttrib('"<<&==&>>"')  // Do not just escape the first occurrence.
   * # '&#34;&lt;&lt;&amp;&#61;&#61;&amp;&gt;&gt;&#34;'
   * $ escapeAttrib('Hello <World>!')
   * # 'Hello &lt;World&gt;!'
   * }
   */
  function escapeAttrib(s) {
    return (`${s}`).replace(ampRe, '&amp;').replace(ltRe, '&lt;')
        .replace(gtRe, '&gt;').replace(quotRe, '&#34;');
  }

  /**
   * Escape entities in RCDATA that can be escaped without changing the meaning.
   * {\@updoc
   * $ normalizeRCData('1 < 2 &&amp; 3 > 4 &amp;& 5 &lt; 7&8')
   * # '1 &lt; 2 &amp;&amp; 3 &gt; 4 &amp;&amp; 5 &lt; 7&amp;8'
   * }
   */
  function normalizeRCData(rcdata) {
    return rcdata
        .replace(looseAmpRe, '&amp;$1')
        .replace(ltRe, '&lt;')
        .replace(gtRe, '&gt;');
  }

  // TODO(mikesamuel): validate sanitizer regexs against the HTML5 grammar at
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/syntax.html
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html
  // http://www.whatwg.org/specs/web-apps/current-work/multipage/tree-construction.html

  // We initially split input so that potentially meaningful characters
  // like '<' and '>' are separate tokens, using a fast dumb process that
  // ignores quoting.  Then we walk that token stream, and when we see a
  // '<' that's the start of a tag, we use ATTR_RE to extract tag
  // attributes from the next token.  That token will never have a '>'
  // character.  However, it might have an unbalanced quote character, and
  // when we see that, we combine additional tokens to balance the quote.

  const ATTR_RE = new RegExp(
      '^\\s*' +
    '([a-z][a-z-]*)' + // 1 = Attribute name
    '(?:' + (
        '\\s*(=)\\s*' + // 2 = Is there a value?
      '(' + ( // 3 = Attribute value
        // TODO(felix8a): maybe use backref to match quotes
          '(\")[^\"]*(\"|$)' + // 4, 5 = Double-quoted string
        '|' +
        '(\')[^\']*(\'|$)' + // 6, 7 = Single-quoted string
        '|' +
        // Positive lookahead to prevent interpretation of
        // <foo a= b=c> as <foo a='b=c'>
        // TODO(felix8a): might be able to drop this case
        '(?=[a-z][a-z-]*\\s*=)' +
        '|' +
        // Unquoted value that isn't an attribute name
        // (since we didn't match the positive lookahead above)
        '[^\"\'\\s]*') +
      ')') +
    ')?',
      'i');

  const ENTITY_RE = /^(#[0-9]+|#x[0-9a-f]+|\w+);/i;

  // false on IE<=8, true on most other browsers
  const splitWillCapture = ('a,b'.split(/(,)/).length === 3);

  // bitmask for tags with special parsing, like <script> and <textarea>
  const EFLAGS_TEXT = html4.eflags.CDATA | html4.eflags.RCDATA;

  /**
   * Given a SAX-like event handler, produce a function that feeds those
   * events and a parameter to the event handler.
   *
   * The event handler has the form:{@code
   * {
   *   // Name is an upper-case HTML tag name.  Attribs is an array of
   *   // alternating upper-case attribute names, and attribute values.  The
   *   // attribs array is reused by the parser.  Param is the value passed to
   *   // the saxParser.
   *   startTag: function (name, attribs, param) { ... },
   *   endTag:   function (name, param) { ... },
   *   pcdata:   function (text, param) { ... },
   *   rcdata:   function (text, param) { ... },
   *   cdata:    function (text, param) { ... },
   *   startDoc: function (param) { ... },
   *   endDoc:   function (param) { ... }
   * }}
   *
   * @param {Object} handler a record containing event handlers.
   * @return {function(string, Object)} A function that takes a chunk of HTML
   *     and a parameter.  The parameter is passed on to the handler methods.
   */
  function makeSaxParser(handler) {
    return function (htmlText, param) {
      return parse(htmlText, handler, param);
    };
  }

  // Parsing strategy is to split input into parts that might be lexically
  // meaningful (every ">" becomes a separate part), and then recombine
  // parts if we discover they're in a different context.

  // Note, html-sanitizer filters unknown tags here, even though they also
  // get filtered out by the sanitizer's handler.  This is back-compat
  // behavior; makeSaxParser is public.

  // TODO(felix8a): Significant performance regressions from -legacy,
  // tested on
  //    Chrome 18.0
  //    Firefox 11.0
  //    IE 6, 7, 8, 9
  //    Opera 11.61
  //    Safari 5.1.3
  // Many of these are unusual patterns that are linearly slower and still
  // pretty fast (eg 1ms to 5ms), so not necessarily worth fixing.

  // TODO(felix8a): "<script> && && && ... <\/script>" is slower on all
  // browsers.  The hotspot is htmlSplit.

  // TODO(felix8a): "<p title='>>>>...'><\/p>" is slower on all browsers.
  // This is partly htmlSplit, but the hotspot is parseTagAndAttrs.

  // TODO(felix8a): "<a><\/a><a><\/a>..." is slower on IE9.
  // "<a>1<\/a><a>1<\/a>..." is faster, "<a><\/a>2<a><\/a>2..." is faster.

  // TODO(felix8a): "<p<p<p..." is slower on IE[6-8]

  function parse(htmlText, handler, param) {
    const h = handler;
    if (h.startDoc) { h.startDoc(param); }
    let m, p, tagName;
    const parts = htmlSplit(htmlText);
    let noMoreGT = false;
    let noMoreEndComments = false;
    for (let pos = 0, end = parts.length; pos < end;) {
      const current = parts[pos++];
      const next = parts[pos];
      switch (current) {
        case '&':
          if (ENTITY_RE.test(next)) {
            if (h.pcdata) { h.pcdata(`&${next}`, param); }
            pos++;
          } else if (h.pcdata) { h.pcdata('&amp;', param); }
          break;
        case '<\/':
          if (m = /^(\w+)[^\'\"]*/.exec(next)) {
            if (m[0].length === next.length && parts[pos + 1] === '>') {
            // fast case, no attribute parsing needed
              pos += 2;
              tagName = lcase(m[1]);
              if (html4.ELEMENTS.hasOwnProperty(tagName)) {
                if (h.endTag) { h.endTag(tagName, param); }
              }
            } else {
            // slow case, need to parse attributes
            // TODO(felix8a): do we really care about misparsing this?
              pos = parseEndTag(parts, pos, h, param);
            }
          } else if (h.pcdata) { h.pcdata('&lt;/', param); }
          break;
        case '<':
          if (m = /^(\w+)\s*\/?/.exec(next)) {
            if (m[0].length === next.length && parts[pos + 1] === '>') {
            // fast case, no attribute parsing needed
              pos += 2;
              tagName = lcase(m[1]);
              if (html4.ELEMENTS.hasOwnProperty(tagName)) {
                if (h.startTag) { h.startTag(tagName, [], param); }
                // tags like <script> and <textarea> have special parsing
                const eflags = html4.ELEMENTS[tagName];
                if (eflags & EFLAGS_TEXT) {
                  const tag = {name: tagName, next: pos, eflags};
                  pos = parseText(parts, tag, h, param);
                }
              }
            } else {
            // slow case, need to parse attributes
              pos = parseStartTag(parts, pos, h, param);
            }
          } else if (h.pcdata) { h.pcdata('&lt;', param); }
          break;
        case '<\!--':
        // The pathological case is n copies of '<\!--' without '-->', and
        // repeated failure to find '-->' is quadratic.  We avoid that by
        // remembering when search for '-->' fails.
          if (!noMoreEndComments) {
          // A comment <\!--x--> is split into three tokens:
          //   '<\!--', 'x--', '>'
          // We want to find the next '>' token that has a preceding '--'.
          // pos is at the 'x--'.
            for (p = pos + 1; p < end; p++) {
              if (parts[p] === '>' && /--$/.test(parts[p - 1])) { break; }
            }
            if (p < end) {
              pos = p + 1;
            } else {
              noMoreEndComments = true;
            }
          }
          if (noMoreEndComments) {
            if (h.pcdata) { h.pcdata('&lt;!--', param); }
          }
          break;
        case '<\!':
          if (!/^\w/.test(next)) {
            if (h.pcdata) { h.pcdata('&lt;!', param); }
          } else {
          // similar to noMoreEndComment logic
            if (!noMoreGT) {
              for (p = pos + 1; p < end; p++) {
                if (parts[p] === '>') { break; }
              }
              if (p < end) {
                pos = p + 1;
              } else {
                noMoreGT = true;
              }
            }
            if (noMoreGT) {
              if (h.pcdata) { h.pcdata('&lt;!', param); }
            }
          }
          break;
        case '<?':
        // similar to noMoreEndComment logic
          if (!noMoreGT) {
            for (p = pos + 1; p < end; p++) {
              if (parts[p] === '>') { break; }
            }
            if (p < end) {
              pos = p + 1;
            } else {
              noMoreGT = true;
            }
          }
          if (noMoreGT) {
            if (h.pcdata) { h.pcdata('&lt;?', param); }
          }
          break;
        case '>':
          if (h.pcdata) { h.pcdata('&gt;', param); }
          break;
        case '':
          break;
        default:
          if (h.pcdata) { h.pcdata(current, param); }
          break;
      }
    }
    if (h.endDoc) { h.endDoc(param); }
  }

  // Split str into parts for the html parser.
  function htmlSplit(str) {
    // can't hoist this out of the function because of the re.exec loop.
    const re = /(<\/|<\!--|<[!?]|[&<>])/g;
    str += '';
    if (splitWillCapture) {
      return str.split(re);
    } else {
      const parts = [];
      let lastPos = 0;
      let m;
      while ((m = re.exec(str)) !== null) {
        parts.push(str.substring(lastPos, m.index));
        parts.push(m[0]);
        lastPos = m.index + m[0].length;
      }
      parts.push(str.substring(lastPos));
      return parts;
    }
  }

  function parseEndTag(parts, pos, h, param) {
    const tag = parseTagAndAttrs(parts, pos);
    // drop unclosed tags
    if (!tag) { return parts.length; }
    if (tag.eflags !== void 0) {
      if (h.endTag) { h.endTag(tag.name, param); }
    }
    return tag.next;
  }

  function parseStartTag(parts, pos, h, param) {
    const tag = parseTagAndAttrs(parts, pos);
    // drop unclosed tags
    if (!tag) { return parts.length; }
    if (tag.eflags !== void 0) {
      if (h.startTag) { h.startTag(tag.name, tag.attrs, param); }
      // tags like <script> and <textarea> have special parsing
      if (tag.eflags & EFLAGS_TEXT) {
        return parseText(parts, tag, h, param);
      }
    }
    return tag.next;
  }

  const endTagRe = {};

  // Tags like <script> and <textarea> are flagged as CDATA or RCDATA,
  // which means everything is text until we see the correct closing tag.
  function parseText(parts, tag, h, param) {
    const end = parts.length;
    if (!endTagRe.hasOwnProperty(tag.name)) {
      endTagRe[tag.name] = new RegExp(`^${tag.name}(?:[\\s\\/]|$)`, 'i');
    }
    const re = endTagRe[tag.name];
    const first = tag.next;
    let p = tag.next + 1;
    for (; p < end; p++) {
      if (parts[p - 1] === '<\/' && re.test(parts[p])) { break; }
    }
    if (p < end) { p -= 1; }
    const buf = parts.slice(first, p).join('');
    if (tag.eflags & html4.eflags.CDATA) {
      if (h.cdata) { h.cdata(buf, param); }
    } else if (tag.eflags & html4.eflags.RCDATA) {
      if (h.rcdata) { h.rcdata(normalizeRCData(buf), param); }
    } else {
      throw new Error('bug');
    }
    return p;
  }

  // at this point, parts[pos-1] is either "<" or "<\/".
  function parseTagAndAttrs(parts, pos) {
    let m = /^(\w+)/.exec(parts[pos]);
    const tag = {name: lcase(m[1])};
    if (html4.ELEMENTS.hasOwnProperty(tag.name)) {
      tag.eflags = html4.ELEMENTS[tag.name];
    } else {
      tag.eflags = void 0;
    }
    let buf = parts[pos].substr(m[0].length);
    // Find the next '>'.  We optimistically assume this '>' is not in a
    // quoted context, and further down we fix things up if it turns out to
    // be quoted.
    let p = pos + 1;
    const end = parts.length;
    for (; p < end; p++) {
      if (parts[p] === '>') { break; }
      buf += parts[p];
    }
    if (end <= p) { return void 0; }
    const attrs = [];
    while (buf !== '') {
      m = ATTR_RE.exec(buf);
      if (!m) {
        // No attribute found: skip garbage
        buf = buf.replace(/^[\s\S][^a-z\s]*/, '');
      } else if ((m[4] && !m[5]) || (m[6] && !m[7])) {
        // Unterminated quote: slurp to the next unquoted '>'
        const quote = m[4] || m[6];
        let sawQuote = false;
        const abuf = [buf, parts[p++]];
        for (; p < end; p++) {
          if (sawQuote) {
            if (parts[p] === '>') { break; }
          } else if (0 <= parts[p].indexOf(quote)) {
            sawQuote = true;
          }
          abuf.push(parts[p]);
        }
        // Slurp failed: lose the garbage
        if (end <= p) { break; }
        // Otherwise retry attribute parsing
        buf = abuf.join('');
        continue;
      } else {
        // We have an attribute
        const aName = lcase(m[1]);
        const aValue = m[2] ? decodeValue(m[3]) : aName;
        attrs.push(aName, aValue);
        buf = buf.substr(m[0].length);
      }
    }
    tag.attrs = attrs;
    tag.next = p + 1;
    return tag;
  }

  function decodeValue(v) {
    const q = v.charCodeAt(0);
    if (q === 0x22 || q === 0x27) { // " or '
      v = v.substr(1, v.length - 2);
    }
    return unescapeEntities(stripNULs(v));
  }

  /**
   * Returns a function that strips unsafe tags and attributes from html.
   * @param {function(string, Array.<string>): ?Array.<string>} tagPolicy
   *     A function that takes (tagName, attribs[]), where tagName is a key in
   *     html4.ELEMENTS and attribs is an array of alternating attribute names
   *     and values.  It should return a sanitized attribute array, or null to
   *     delete the tag.  It's okay for tagPolicy to modify the attribs array,
   *     but the same array is reused, so it should not be held between calls.
   * @return {function(string, Array)} A function that sanitizes a string of
   *     HTML and appends result strings to the second argument, an array.
   */
  function makeHtmlSanitizer(tagPolicy) {
    let stack;
    let ignoring;
    const emit = function (text, out) {
      if (!ignoring) { out.push(text); }
    };
    return makeSaxParser({
      startDoc(_) {
        stack = [];
        ignoring = false;
      },
      startTag(tagName, attribs, out) {
        if (ignoring) { return; }
        if (!html4.ELEMENTS.hasOwnProperty(tagName)) { return; }
        const eflags = html4.ELEMENTS[tagName];
        if (eflags & html4.eflags.FOLDABLE) {
          return;
        }
        attribs = tagPolicy(tagName, attribs);
        if (!attribs) {
          ignoring = !(eflags & html4.eflags.EMPTY);
          return;
        }
        // TODO(mikesamuel): relying on tagPolicy not to insert unsafe
        // attribute names.
        if (!(eflags & html4.eflags.EMPTY)) {
          stack.push(tagName);
        }

        out.push('<', tagName);
        for (let i = 0, n = attribs.length; i < n; i += 2) {
          const attribName = attribs[i];
          const value = attribs[i + 1];
          if (value !== null && value !== void 0) {
            out.push(' ', attribName, '="', escapeAttrib(value), '"');
          }
        }
        out.push('>');
      },
      endTag(tagName, out) {
        if (ignoring) {
          ignoring = false;
          return;
        }
        if (!html4.ELEMENTS.hasOwnProperty(tagName)) { return; }
        const eflags = html4.ELEMENTS[tagName];
        if (!(eflags & (html4.eflags.EMPTY | html4.eflags.FOLDABLE))) {
          let index;
          if (eflags & html4.eflags.OPTIONAL_ENDTAG) {
            for (index = stack.length; --index >= 0;) {
              var stackEl = stack[index];
              if (stackEl === tagName) { break; }
              if (!(html4.ELEMENTS[stackEl] &
                    html4.eflags.OPTIONAL_ENDTAG)) {
                // Don't pop non optional end tags looking for a match.
                return;
              }
            }
          } else {
            for (index = stack.length; --index >= 0;) {
              if (stack[index] === tagName) { break; }
            }
          }
          if (index < 0) { return; } // Not opened.
          for (let i = stack.length; --i > index;) {
            var stackEl = stack[i];
            if (!(html4.ELEMENTS[stackEl] &
                  html4.eflags.OPTIONAL_ENDTAG)) {
              out.push('<\/', stackEl, '>');
            }
          }
          stack.length = index;
          out.push('<\/', tagName, '>');
        }
      },
      pcdata: emit,
      rcdata: emit,
      cdata: emit,
      endDoc(out) {
        for (; stack.length; stack.length--) {
          out.push('<\/', stack[stack.length - 1], '>');
        }
      },
    });
  }

  // From RFC3986
  const URI_SCHEME_RE = new RegExp(
      '^' +
      '(?:' +
        '([^:\/?# ]+)' + // scheme
      ':)?'
  );

  const ALLOWED_URI_SCHEMES = /^(?:https?|mailto)$/i;

  function safeUri(uri, naiveUriRewriter) {
    if (!naiveUriRewriter) { return null; }
    const parsed = (`${uri}`).match(URI_SCHEME_RE);
    if (parsed && (!parsed[1] || ALLOWED_URI_SCHEMES.test(parsed[1]))) {
      return naiveUriRewriter(uri);
    } else {
      return null;
    }
  }

  /**
   * Sanitizes attributes on an HTML tag.
   * @param {string} tagName An HTML tag name in lowercase.
   * @param {Array.<?string>} attribs An array of alternating names and values.
   * @param {?function(?string): ?string} opt_naiveUriRewriter A transform to
   *     apply to URI attributes; it can return a new string value, or null to
   *     delete the attribute.  If unspecified, URI attributes are deleted.
   * @param {function(?string): ?string} opt_nmTokenPolicy A transform to apply
   *     to attributes containing HTML names, element IDs, and space-separated
   *     lists of classes; it can return a new string value, or null to delete
   *     the attribute.  If unspecified, these attributes are kept unchanged.
   * @return {Array.<?string>} The sanitized attributes as a list of alternating
   *     names and values, where a null value means to omit the attribute.
   */
  function sanitizeAttribs(
      tagName, attribs, opt_naiveUriRewriter, opt_nmTokenPolicy) {
    for (let i = 0; i < attribs.length; i += 2) {
      const attribName = attribs[i];
      let value = attribs[i + 1];
      let atype = null; var
        attribKey;
      if ((attribKey = `${tagName}::${attribName}`,
      html4.ATTRIBS.hasOwnProperty(attribKey)) ||
          (attribKey = `*::${attribName}`,
          html4.ATTRIBS.hasOwnProperty(attribKey))) {
        atype = html4.ATTRIBS[attribKey];
      }
      if (atype !== null) {
        switch (atype) {
          case html4.atype.NONE: break;
          case html4.atype.SCRIPT:
            value = null;
            break;
          case html4.atype.STYLE:
            if ('undefined' === typeof parseCssDeclarations) {
              value = null;
              break;
            }
            var sanitizedDeclarations = [];
            parseCssDeclarations(
                value,
                {
                  declaration(property, tokens) {
                    const normProp = property.toLowerCase();
                    const schema = cssSchema[normProp];
                    if (!schema) {
                      return;
                    }
                    sanitizeCssProperty(
                        schema, tokens,
                        opt_naiveUriRewriter);
                    sanitizedDeclarations.push(`${property}: ${tokens.join(' ')}`);
                  },
                });
            value = sanitizedDeclarations.length > 0 ? sanitizedDeclarations.join(' ; ') : null;
            break;
          case html4.atype.ID:
          case html4.atype.IDREF:
          case html4.atype.IDREFS:
          case html4.atype.GLOBAL_NAME:
          case html4.atype.LOCAL_NAME:
          case html4.atype.CLASSES:
            value = opt_nmTokenPolicy ? opt_nmTokenPolicy(value) : value;
            break;
          case html4.atype.URI:
            value = safeUri(value, opt_naiveUriRewriter);
            break;
          case html4.atype.URI_FRAGMENT:
            if (value && '#' === value.charAt(0)) {
              value = value.substring(1); // remove the leading '#'
              value = opt_nmTokenPolicy ? opt_nmTokenPolicy(value) : value;
              if (value !== null && value !== void 0) {
                value = `#${value}`; // restore the leading '#'
              }
            } else {
              value = null;
            }
            break;
          default:
            value = null;
            break;
        }
      } else {
        value = null;
      }
      attribs[i + 1] = value;
    }
    return attribs;
  }

  /**
   * Creates a tag policy that omits all tags marked UNSAFE in html4-defs.js
   * and applies the default attribute sanitizer with the supplied policy for
   * URI attributes and NMTOKEN attributes.
   * @param {?function(?string): ?string} opt_naiveUriRewriter A transform to
   *     apply to URI attributes.  If not given, URI attributes are deleted.
   * @param {function(?string): ?string} opt_nmTokenPolicy A transform to apply
   *     to attributes containing HTML names, element IDs, and space-separated
   *     lists of classes.  If not given, such attributes are left unchanged.
   * @return {function(string, Array.<?string>)} A tagPolicy suitable for
   *     passing to html.sanitize.
   */
  function makeTagPolicy(opt_naiveUriRewriter, opt_nmTokenPolicy) {
    return function (tagName, attribs) {
      if (!(html4.ELEMENTS[tagName] & html4.eflags.UNSAFE)) {
        return sanitizeAttribs(
            tagName, attribs, opt_naiveUriRewriter, opt_nmTokenPolicy);
      }
    };
  }

  /**
   * Sanitizes HTML tags and attributes according to a given policy.
   * @param {string} inputHtml The HTML to sanitize.
   * @param {function(string, Array.<?string>)} tagPolicy A function that
   *     decides which tags to accept and sanitizes their attributes (see
   *     makeHtmlSanitizer above for details).
   * @return {string} The sanitized HTML.
   */
  function sanitizeWithPolicy(inputHtml, tagPolicy) {
    const outputArray = [];
    makeHtmlSanitizer(tagPolicy)(inputHtml, outputArray);
    return outputArray.join('');
  }

  /**
   * Strips unsafe tags and attributes from HTML.
   * @param {string} inputHtml The HTML to sanitize.
   * @param {?function(?string): ?string} opt_naiveUriRewriter A transform to
   *     apply to URI attributes.  If not given, URI attributes are deleted.
   * @param {function(?string): ?string} opt_nmTokenPolicy A transform to apply
   *     to attributes containing HTML names, element IDs, and space-separated
   *     lists of classes.  If not given, such attributes are left unchanged.
   */
  function sanitize(inputHtml, opt_naiveUriRewriter, opt_nmTokenPolicy) {
    const tagPolicy = makeTagPolicy(opt_naiveUriRewriter, opt_nmTokenPolicy);
    return sanitizeWithPolicy(inputHtml, tagPolicy);
  }

  return {
    escapeAttrib,
    makeHtmlSanitizer,
    makeSaxParser,
    makeTagPolicy,
    normalizeRCData,
    sanitize,
    sanitizeAttribs,
    sanitizeWithPolicy,
    unescapeEntities,
  };
})(html4);

var html_sanitize = html.sanitize;

// Exports for closure compiler.  Note this file is also cajoled
// for domado and run in an environment without 'window'
if (typeof window !== 'undefined') {
  window.html = html;
  window.html_sanitize = html_sanitize;
}
