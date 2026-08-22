import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalculatorNumber } from '../src/utils/mathExpression.js';

test('parseCalculatorNumber supports basic arithmetic and formatting', () => {
  assert.equal(parseCalculatorNumber('1200/30'), 40);
  assert.equal(parseCalculatorNumber('49*1.2'), 58.8);
  assert.equal(parseCalculatorNumber('$1,200'), 1200);
  assert.equal(parseCalculatorNumber('(10+5)*2'), 30);
  assert.equal(parseCalculatorNumber('-5 + 2'), -3);
  assert.equal(parseCalculatorNumber('2^3'), 8);
});

test('parseCalculatorNumber rejects invalid input', () => {
  assert.ok(Number.isNaN(parseCalculatorNumber('')));
  assert.ok(Number.isNaN(parseCalculatorNumber('hello')));
  assert.ok(Number.isNaN(parseCalculatorNumber('1;alert(1)')));
  assert.ok(Number.isNaN(parseCalculatorNumber('()')));
});

