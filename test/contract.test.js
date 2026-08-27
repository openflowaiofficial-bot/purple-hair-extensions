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
  const r = validate(good.slice(0, 120));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /121/);
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

/* The Chocolate Truffle migration. The colour is in COFFEE and its swatch is
   committed before Square has it, so the contract has to accept the catalogue
   on both sides of that change — and nothing in between, or a catalogue that
   had quietly lost variations would sail through. */
const truffle = ['WFT', 'VOL', 'PLS'].flatMap(method =>
  ['14"-16"', '18"-20"', '22"-24"'].map(length => ({
    sku: `PCE-${method}-CHT-${length.replace(/\D/g, '').slice(0, 4)}`,
    method,
    collection: 'Coffee Collection',
    color: 'Chocolate Truffle',
    length,
    price: 33500
  })));

test('Chocolate Truffle is nine variations, not some other number', () => {
  assert.equal(truffle.length, 9);
  assert.equal(good.length + truffle.length, 130);
});

test('Square with Chocolate Truffle added passes', () => {
  assert.deepEqual(validate(good.concat(truffle)), { ok: true, problems: [] });
});

test('a count between the two ends still fails', () => {
  const half = good.concat(truffle.slice(0, 4)); // 125
  const r = validate(half);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /125/);
});

test('Chocolate Truffle on Plus Lace is allowed, being a Coffee colour', () => {
  const pls = truffle.filter(v => v.method === 'PLS');
  assert.equal(pls.length, 3);
  assert.equal(validate(good.concat(truffle)).problems.length, 0);
});
