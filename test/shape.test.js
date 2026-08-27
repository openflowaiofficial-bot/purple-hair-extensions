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
  const d = clone.objects[0].item_data.variations[0].item_variation_data;
  delete d.price_money;
  d.location_overrides = [];
  assert.equal(shape(clone, 'L0MRDCWWBFR3Z').length, 120);
});

test('resolves the base price when a variation has no overrides at all', () => {
  const singleVariationBody = { objects: [{
    type: 'ITEM', id: 'ITEM_TEST', item_data: { name: 'Test Item', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_TEST_1', item_variation_data: {
        sku: 'PCE-WFT-TST-1416', name: 'Brittany | 14"-16"',
        price_money: { amount: 20800, currency: 'USD' } } }
    ] } }] };
  const v = shape(singleVariationBody, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-TST-1416');
  assert.ok(v, 'expected the variation to survive shape()');
  assert.equal(v.price, 20800);
});

test('falls back to the base price when the only override belongs to another location', () => {
  const singleVariationBody = { objects: [{
    type: 'ITEM', id: 'ITEM_TEST', item_data: { name: 'Test Item', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_TEST_2', item_variation_data: {
        sku: 'PCE-WFT-TST-1820', name: 'Brittany | 18"-20"',
        price_money: { amount: 20800, currency: 'USD' },
        location_overrides: [{ location_id: 'L1RH8QK7VWXYZ',
          price_money: { amount: 55000, currency: 'USD' } }] } }
    ] } }] };
  const v = shape(singleVariationBody, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-TST-1820');
  assert.ok(v, 'expected the variation to survive shape()');
  assert.equal(v.price, 20800);
  assert.notEqual(v.price, 55000);
});

test('an override for our location wins over a different base price', () => {
  const singleVariationBody = { objects: [{
    type: 'ITEM', id: 'ITEM_TEST', item_data: { name: 'Test Item', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_TEST_3', item_variation_data: {
        sku: 'PCE-WFT-TST-2224', name: 'Brittany | 22"-24"',
        price_money: { amount: 20800, currency: 'USD' },
        location_overrides: [{ location_id: 'L0MRDCWWBFR3Z',
          price_money: { amount: 19900, currency: 'USD' } }] } }
    ] } }] };
  const v = shape(singleVariationBody, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-TST-2224');
  assert.ok(v, 'expected the variation to survive shape()');
  assert.equal(v.price, 19900);
});

test('drops a variation with neither a usable override nor a base price', () => {
  const singleVariationBody = { objects: [{
    type: 'ITEM', id: 'ITEM_TEST', item_data: { name: 'Test Item', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_TEST_4', item_variation_data: {
        sku: 'PCE-WFT-TST-2729', name: 'Brittany | 27"-29"',
        location_overrides: [{ location_id: 'L1RH8QK7VWXYZ',
          price_money: { amount: 55000, currency: 'USD' } }] } }
    ] } }] };
  assert.equal(shape(singleVariationBody, 'L0MRDCWWBFR3Z').length, 0);
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

test('accepts Square\'s comma-joined variation name', () => {
  // Square rebuilds the name from option values with a comma, whatever the
  // import file used. This is the shape production actually returns.
  const one = { objects: [{ type: 'ITEM', id: 'I1', item_data: { name: 'Weft', variations: [
    { type: 'ITEM_VARIATION', id: 'V1', item_variation_data: {
      sku: 'PCE-WFT-AMB-2224', name: 'Amber, 22"-24"',
      price_money: { amount: 33500, currency: 'USD' } } }] } }] };
  const [v] = shape(one, 'L0MRDCWWBFR3Z');
  assert.equal(v.color, 'Amber');
  assert.equal(v.length, '22"-24"');
  assert.equal(v.price, 33500);
});

test('still accepts the pipe-joined name our import wrote', () => {
  const one = { objects: [{ type: 'ITEM', id: 'I1', item_data: { name: 'Weft', variations: [
    { type: 'ITEM_VARIATION', id: 'V1', item_variation_data: {
      sku: 'PCE-WFT-AMB-2224', name: 'Amber | 22"-24"',
      price_money: { amount: 33500, currency: 'USD' } } }] } }] };
  const [v] = shape(one, 'L0MRDCWWBFR3Z');
  assert.equal(v.color, 'Amber');
  assert.equal(v.length, '22"-24"');
});

test('a name with no delimiter at all is dropped, not half-parsed', () => {
  const one = { objects: [{ type: 'ITEM', id: 'I1', item_data: { name: 'Weft', variations: [
    { type: 'ITEM_VARIATION', id: 'V1', item_variation_data: {
      sku: 'PCE-WFT-AMB-2224', name: 'Amber 22 inch',
      price_money: { amount: 33500, currency: 'USD' } } }] } }] };
  assert.equal(shape(one, 'L0MRDCWWBFR3Z').length, 0);
});

test('a multi-word colour survives the first-delimiter split', () => {
  const one = { objects: [{ type: 'ITEM', id: 'I1', item_data: { name: 'Weft', variations: [
    { type: 'ITEM_VARIATION', id: 'V1', item_variation_data: {
      sku: 'PCE-WFT-CRM-1416', name: 'Caramel Macchiato, 14"-16"',
      price_money: { amount: 20800, currency: 'USD' } } }] } }] };
  const [v] = shape(one, 'L0MRDCWWBFR3Z');
  assert.equal(v.color, 'Caramel Macchiato');
  assert.equal(v.length, '14"-16"');
});
