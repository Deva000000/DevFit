import test from 'node:test';
import assert from 'node:assert/strict';
import parser from '../receipt-amount.js';

test('prefers paid total to available balance and fees',()=>{
  const result=parser.parseReceiptAmount('Amount Paid: RM 200.00\nTransaction Fee RM 0.00\nAvailable Balance RM 3,500.00');
  assert.equal(result.amountCents,20000);
  assert.equal(result.ambiguous,false);
});
test('detects coaching and app amounts',()=>{
  for(const [printed,cents] of [['RM160.00',16000],['Total Paid MYR 360.00',36000],['RM19.90',1990]]){
    assert.equal(parser.parseReceiptAmount(printed).amountCents,cents);
  }
});
test('flags competing amounts rather than declaring verification',()=>{
  const result=parser.parseReceiptAmount('Amount Paid RM200.00\nAmount Paid RM500.00');
  assert.equal(result.ambiguous,true);
});
test('does not invent an amount when OCR is unreadable',()=>{
  assert.equal(parser.parseReceiptAmount('successful transfer').amountCents,null);
});
