import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, plainInline, blockTexts, withTexts } from './markdownBlocks';

test('plainInline strips bold, italic, links, images and code', () => {
  assert.equal(plainInline('Das ist **fett** und *kursiv* und `code`.'), 'Das ist fett und kursiv und code.');
  assert.equal(plainInline('Mehr auf [unserer Seite](https://example.org/x) lesen.'), 'Mehr auf unserer Seite lesen.');
  assert.equal(plainInline('Bild: ![Herrfurthplatz](./images/platz.jpg) fertig'), 'Bild: Herrfurthplatz fertig');
  assert.equal(plainInline('Zeile<br />Umbruch  doppelt'), 'Zeile Umbruch doppelt');
});

test('plainInline leaves intraword underscores and arithmetic asterisks alone', () => {
  assert.equal(plainInline('Zeile mit some_thing_here im Text.'), 'Zeile mit some_thing_here im Text.');
  assert.equal(plainInline('5*3=15 und weiter *kursiv* Text.'), '5*3=15 und weiter kursiv Text.');
  assert.equal(plainInline('__stark__ und _leise_ hier'), 'stark und leise hier');
  assert.equal(plainInline('**Otto Hempel (Die PARTEI)**: Text'), 'Otto Hempel (Die PARTEI): Text');
  assert.equal(plainInline('a * b * c'), 'a * b * c');
});

test('paragraphs join soft line breaks and split on blank lines', () => {
  const md = 'Liebe Nachbarinnen und Nachbarn,\n\neigentlich sollte hier\njemand anderes schreiben.\n\n';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'p', text: 'Liebe Nachbarinnen und Nachbarn,' },
    { kind: 'p', text: 'eigentlich sollte hier jemand anderes schreiben.' },
  ]);
});

test('headings map to h2/h3 and end the running paragraph', () => {
  const md = 'Intro\n# Eins\n## Zwei\n### Drei\n#### Vier\nText';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'p', text: 'Intro' },
    { kind: 'h2', text: 'Eins' },
    { kind: 'h2', text: 'Zwei' },
    { kind: 'h3', text: 'Drei' },
    { kind: 'h3', text: 'Vier' },
    { kind: 'p', text: 'Text' },
  ]);
});

test('blockquotes join their lines, lists keep one item per line', () => {
  const md = '> Erste Zeile\n> zweite Zeile\n\n- **Eins**\n- Zwei\n\n1. Alpha\n2. Beta\n3) Gamma';
  assert.deepEqual(parseBlocks(md), [
    { kind: 'quote', text: 'Erste Zeile zweite Zeile' },
    { kind: 'ul', items: ['Eins', 'Zwei'] },
    { kind: 'ol', items: ['Alpha', 'Beta', 'Gamma'] },
  ]);
});

test('list followed directly by a paragraph line without a blank line ends the list', () => {
  assert.deepEqual(parseBlocks('- a\n- b\nDanach'), [
    { kind: 'ul', items: ['a', 'b'] },
    { kind: 'p', text: 'Danach' },
  ]);
});

test('indented continuation lines belong to the previous list item', () => {
  assert.deepEqual(parseBlocks('- a erste\n  a zweite\n- b'), [{ kind: 'ul', items: ['a erste a zweite', 'b'] }]);
});

test('horizontal rules and MDX import/export lines produce nothing', () => {
  const md = "import X from './X.astro'\n\nText\n\n---\n\n***\n\nexport const a = 1\n\nEnde";
  assert.deepEqual(parseBlocks(md), [{ kind: 'p', text: 'Text' }, { kind: 'p', text: 'Ende' }]);
});

test('empty and whitespace-only input yields no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks('\n  \n\r\n'), []);
});

test('blockTexts flattens in document order; withTexts rebuilds and checks the count', () => {
  const blocks = parseBlocks('## Kopf\n\nAbsatz\n\n- eins\n- zwei');
  assert.deepEqual(blockTexts(blocks), ['Kopf', 'Absatz', 'eins', 'zwei']);
  assert.deepEqual(withTexts(blocks, ['Head', 'Paragraph', 'one', 'two']), [
    { kind: 'h2', text: 'Head' },
    { kind: 'p', text: 'Paragraph' },
    { kind: 'ul', items: ['one', 'two'] },
  ]);
  assert.throws(() => withTexts(blocks, ['Head', 'Paragraph', 'one']), /too few/);
  assert.throws(() => withTexts(blocks, ['Head', 'Paragraph', 'one', 'two', 'extra']), /too many/);
});

test('withTexts does not mutate its input', () => {
  const blocks = parseBlocks('Absatz');
  withTexts(blocks, ['Paragraph']);
  assert.deepEqual(blocks, [{ kind: 'p', text: 'Absatz' }]);
});

test('a bl-steps group keeps its pictures in place', () => {
  const md = [
    '1. Tippe oben rechts.',
    '2. Wähle „Installieren“.',
    '',
    '<div class="bl-steps">',
    '  <img src="/assets/blog/install/android-1-menue.svg" alt="Zeichnung: die drei Punkte" width="320" height="400" loading="lazy" />',
    '  <img src="/assets/blog/install/mitteilungen-glocke.png" alt="" width="320" height="400" loading="lazy" />',
    '</div>',
    '',
    'Danach geht es weiter.',
  ].join('\n');
  assert.deepEqual(parseBlocks(md), [
    { kind: 'ol', items: ['Tippe oben rechts.', 'Wähle „Installieren“.'] },
    {
      kind: 'pics',
      wide: false,
      pics: [
        { src: '/assets/blog/install/android-1-menue.svg', alt: 'Zeichnung: die drei Punkte', width: 320, height: 400 },
        { src: '/assets/blog/install/mitteilungen-glocke.png', alt: '', width: 320, height: 400 },
      ],
    },
    { kind: 'p', text: 'Danach geht es weiter.' },
  ]);
});

test('bl-steps--wide is carried, foreign and odd picture sources are dropped', () => {
  const md = [
    '<div class="bl-steps bl-steps--wide">',
    '  <img src="/assets/blog/install/desktop-1.svg" alt="Breit" width="560" height="300" />',
    '  <img src="https://example.org/x.png" alt="fremd" />',
    '  <img src="/assets/../secret.png" alt="hoch" />',
    '  <img src="/assets/blog/x.svg?y=1" alt="query" />',
    '  <img src="javascript:alert(1)" alt="js" />',
    '</div>',
    '<div class="bl-steps">',
    '  <img src="//evil.example/a.png" alt="nur fremd" />',
    '</div>',
    '<div class="andere">',
    'Text in einem anderen Kasten.',
    '</div>',
  ].join('\n');
  assert.deepEqual(parseBlocks(md), [
    { kind: 'pics', wide: true, pics: [{ src: '/assets/blog/install/desktop-1.svg', alt: 'Breit', width: 560, height: 300 }] },
    { kind: 'p', text: 'Text in einem anderen Kasten.' },
  ]);
});

test('picture alt texts travel through blockTexts and withTexts, empty ones stay empty', () => {
  const blocks = parseBlocks(
    'Vorher.\n\n<div class="bl-steps">\n<img src="/assets/a.svg" alt="Eins" />\n<img src="/assets/b.svg" alt="" />\n<img src="/assets/c.svg" alt="Drei" />\n</div>\n\nNachher.'
  );
  assert.deepEqual(blockTexts(blocks), ['Vorher.', 'Eins', 'Drei', 'Nachher.']);
  const tr = withTexts(blocks, ['Before.', 'One', 'Three', 'After.']);
  assert.deepEqual(tr, [
    { kind: 'p', text: 'Before.' },
    { kind: 'pics', wide: false, pics: [{ src: '/assets/a.svg', alt: 'One' }, { src: '/assets/b.svg', alt: '' }, { src: '/assets/c.svg', alt: 'Three' }] },
    { kind: 'p', text: 'After.' },
  ]);
  assert.throws(() => withTexts(blocks, ['Before.', 'One', 'After.']));
});

test('an unclosed bl-steps group still yields its pictures', () => {
  assert.deepEqual(parseBlocks('<div class="bl-steps">\n<img src="/assets/a.svg" alt="A" />'), [
    { kind: 'pics', wide: false, pics: [{ src: '/assets/a.svg', alt: 'A' }] },
  ]);
});
