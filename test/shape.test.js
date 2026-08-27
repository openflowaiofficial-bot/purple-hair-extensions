const { test } = require('node:test');
const assert = require('node:assert');
const { shape } = require('../api/_shape.js');
const { validate } = require('../api/_contract.js');
const body = require('./fixtures/square-catalog.json');

test('shapes all 121 of ours', () => {
  assert.equal(shape(body, 'L0MRDCWWBFR3Z').length, 121);
});

test('takes the wholesale location price', () => {
  const v = shape(body, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-AMB-2224');
  assert.equal(v.price, 33500);
  assert.equal(v.method, 'WFT');
});

test('drops anything without a PCE- SKU', () => {
  const dirty = { objects: body.objects.concat([{
    type: 'ITEM', id: 'ITEM_CLIP', item_data: { name: 'Clip In Sets', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_CLIP', item_variation_data: {
        sku: '1178054', name: '16" / Beth',
        location_overrides: [{ location_id: 'L0MRDCWWBFR3Z',
          price_money: { amount: 39900, currency: 'USD' } }] } }] } }]) };
  assert.equal(shape(dirty, 'L0MRDCWWBFR3Z').length, 121);
});

test('drops a variation with no price at our location', () => {
  const clone = JSON.parse(JSON.stringify(body));
  clone.objects[0].item_data.variations[0].item_variation_data.location_overrides = [];
  assert.equal(shape(clone, 'L0MRDCWWBFR3Z').length, 120);
});

test('derives collection, color and length for a Coffee Collection variation', () => {
  const v = shape(body, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-CHL-1416');
  assert.equal(v.collection, 'Coffee Collection');
  assert.equal(v.color, 'Chai Latte');
  assert.equal(v.length, '14"-16"');
});

test('derives collection, color and length for a Single Colors variation', () => {
  const v = shape(body, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-AMB-2224');
  assert.equal(v.collection, 'Single Colors');
  assert.equal(v.color, 'Amber');
  assert.equal(v.length, '22"-24"');
});

test('shaped output of the committed fixture passes the contract validator', () => {
  const variations = shape(body, 'L0MRDCWWBFR3Z');
  assert.deepEqual(validate(variations), { ok: true, problems: [] });
});
