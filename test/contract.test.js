// test/contract.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { validate } = require('../api/_contract.js');

const good = require('./fixtures/square-catalog.json').objects
  .flatMap(i => i.item_data.variations.map(v => ({
    sku: v.item_variation_data.sku,
    method: v.item_variation_data.sku.split('-')[1],
    collection: v._collection, color: v._color, length: v._length,
    price: v.item_variation_data.location_overrides[0].price_money.amount
  })));

test('the real catalog passes', () => {
  assert.deepEqual(validate(good), { ok: true, problems: [] });
});

test('a missing variation fails on count', () => {
  const r = validate(good.slice(0, 129));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /130/);
});

test('Plus Lace in a single colour fails', () => {
  const bad = good.concat([{ sku: 'PCE-PLS-BRT-1416', method: 'PLS',
    collection: 'Single Colors', color: 'Brittany', length: '14"-16"', price: 1 }]);
  assert.match(validate(bad).problems.join(' '), /Plus Lace/);
});

test('a Coffee 27"-29" fails', () => {
  const bad = good.concat([{ sku: 'PCE-WFT-CHL-2729', method: 'WFT',
    collection: 'Coffee Collection', color: 'Chai Latte', length: '27"-29"', price: 1 }]);
  assert.match(validate(bad).problems.join(' '), /27/);
});

/* The Chocolate Truffle migration completed on 2026-08-28: the colour exists
   in Square on all three methods and the fixture includes it. The transitional
   [121, 130] window is closed — the old pre-migration count must now FAIL, or
   a catalogue that quietly lost the nine new variations would sail through. */
const truffle = good.filter(v => v.color === 'Chocolate Truffle');

test('Chocolate Truffle is nine variations across the three methods', () => {
  assert.equal(truffle.length, 9);
  assert.deepEqual(
    [...new Set(truffle.map(v => v.method))].sort(), ['PLS', 'VOL', 'WFT']);
  assert.equal(good.length, 130);
});

test('the pre-migration count of 121 now fails', () => {
  const withoutTruffle = good.filter(v => v.color !== 'Chocolate Truffle');
  const r = validate(withoutTruffle);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /121/);
});

test('Chocolate Truffle on Plus Lace is allowed, being a Coffee colour', () => {
  const pls = truffle.filter(v => v.method === 'PLS');
  assert.equal(pls.length, 3);
  assert.deepEqual(validate(good), { ok: true, problems: [] });
});
