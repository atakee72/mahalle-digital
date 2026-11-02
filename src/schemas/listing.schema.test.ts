// Run: npx tsx --test src/schemas/listing.schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListingCreateSchema, ListingDraftSchema, ListingUpdateSchema } from './listing.schema';

const delta = { ops: [{ insert: 'x' }] };
const text = 'Ein Regal aus Holz, gut erhalten, abzuholen im Kiez.';
const create = {
  title: 'Regal aus Holz',
  description: text,
  descriptionPlainText: text,
  listingType: 'sell',
  category: 'moebel',
  price: 12,
  images: ['https://res.cloudinary.com/demo/image/upload/mahalle/listings/a.jpg'],
  delivery: 'abholung',
};
const update = { title: 'Regal aus Holz' };
const draft = { title: 'Regal' };
const schemas = [
  ['create', ListingCreateSchema, create],
  ['update', ListingUpdateSchema, update],
  ['draft', ListingDraftSchema, draft],
] as const;

test('a full create payload passes', () => {
  assert.equal(ListingCreateSchema.safeParse(create).success, true);
});

for (const [name, schema, base] of schemas) {
  test(`${name}: a rich-text object as description is refused`, () => {
    assert.equal(schema.safeParse({ ...base, description: delta }).success, false);
  });
  test(`${name}: a description of 2000 characters passes`, () => {
    assert.equal(schema.safeParse({ ...base, description: 'a'.repeat(2000) }).success, true);
  });
  test(`${name}: a description of 2001 characters is refused`, () => {
    assert.equal(schema.safeParse({ ...base, description: 'a'.repeat(2001) }).success, false);
  });
}

test('create needs a description, update and draft do not', () => {
  const { description: _gone, ...withoutDescription } = create;
  assert.equal(ListingCreateSchema.safeParse(withoutDescription).success, false);
  assert.equal(ListingUpdateSchema.safeParse(update).success, true);
  assert.equal(ListingDraftSchema.safeParse(draft).success, true);
});
