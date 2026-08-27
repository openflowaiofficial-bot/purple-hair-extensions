const { test } = require('node:test');
const assert = require('node:assert');
const Cart = require('../cart.js');

function mem(seed) {
  const m = new Map(seed ? [['pce_cart', seed]] : []);
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v),
           removeItem: k => m.delete(k) };
}

test('starts empty', () => assert.deepEqual(Cart.read(mem()), []));

test('adds and accumulates the same variation', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1);
  assert.deepEqual(Cart.add(s, 'VAR_A', 2), [{ variationId: 'VAR_A', qty: 3 }]);
});

test('never persists a price even if handed one', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1, { price: 33500 });
  assert.ok(!s.getItem('pce_cart').includes('33500'));
  assert.deepEqual(Object.keys(Cart.read(s)[0]).sort(), ['qty', 'variationId']);
});

test('survives corrupt storage', () => {
  assert.deepEqual(Cart.read(mem('{not json')), []);
  assert.deepEqual(Cart.read(mem('{"variationId":"x"}')), []);
  assert.deepEqual(Cart.read(mem('[{"qty":2}]')), []);
});

test('removing and clearing', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1); Cart.add(s, 'VAR_B', 1);
  assert.deepEqual(Cart.remove(s, 'VAR_A'), [{ variationId: 'VAR_B', qty: 1 }]);
  assert.deepEqual(Cart.clear(s), []);
});

test('quantity is clamped to a sane range', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 999);
  assert.equal(Cart.read(s)[0].qty, 99);
  assert.deepEqual(Cart.setQty(s, 'VAR_A', 0), []);
});
