import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_LANGS, deeplTargetFor, primaryLang } from './targetLangs';

test('the list is the full DeepL set: well above the 30 the landing page promises, no duplicates, lowercase primaries', () => {
  assert.ok(TARGET_LANGS.length >= 100);
  assert.equal(new Set(TARGET_LANGS).size, TARGET_LANGS.length);
  for (const l of TARGET_LANGS) assert.match(l, /^[a-z]{2,3}$/);
});

test('deeplTargetFor maps a browser tag to the code DeepL expects', () => {
  assert.equal(deeplTargetFor('tr-TR'), 'TR');
  assert.equal(deeplTargetFor('fa'), 'FA'); // Farsi was missing from the hand-picked 15
  assert.equal(deeplTargetFor('vi'), 'VI');
  assert.equal(deeplTargetFor('en-GB'), 'EN-US'); // DeepL has no plain EN
  assert.equal(deeplTargetFor('pt-BR'), 'PT-PT'); // nor a plain PT
  assert.equal(deeplTargetFor('de-CH'), 'DE');
  assert.equal(deeplTargetFor('zh-Hant'), 'ZH');
  assert.equal(deeplTargetFor('ku'), null); // Kurdish: not offered by DeepL
  assert.equal(deeplTargetFor(''), null);
  assert.equal(primaryLang(' AR-EG '), 'ar');
});
