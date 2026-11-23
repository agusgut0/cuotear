import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, externalHref, html, SafeHtml } from '../../src/site/html.js';

describe('html template tag', () => {
  test('escapes every interpolated string', () => {
    const hostile = `<script>alert("x")</script> & 'q'`;
    assert.equal(String(html`<p>${hostile}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
  });

  test('a value cannot break out of a quoted attribute', () => {
    const markup = String(html`<a title="${'" onmouseover="alert(1)'}">x</a>`);
    assert.equal(markup, '<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
  });

  test('markup from another html template is kept, arrays are joined, nullish values vanish', () => {
    const item = (/** @type {string} */ text) => html`<li>${text}</li>`;
    assert.equal(String(html`<ul>${['<a>', 'b'].map(item)}${null}${undefined}${false}</ul>`), '<ul><li>&lt;a&gt;</li><li>b</li></ul>');
  });

  test('a string that looks like markup is not trusted, even when nested in an array', () => {
    assert.equal(String(html`${['<b>x</b>']}`), '&lt;b&gt;x&lt;/b&gt;');
  });

  test('SafeHtml cannot be forged from outside the module', () => {
    assert.throws(() => new SafeHtml('<script>', Symbol('forged')), TypeError);
  });

  test('escapeHtml covers the five special characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('externalHref', () => {
  test('keeps https links and drops everything else', () => {
    assert.equal(externalHref('https://www.oncity.com/x/p'), 'https://www.oncity.com/x/p');
    assert.equal(externalHref('javascript:alert(1)'), null);
    assert.equal(externalHref('http://www.oncity.com/'), null);
    assert.equal(externalHref('not a url'), null);
  });
});
