import * as money from '../lib/money';
import * as lifecycle from '../lib/estimate-lifecycle';
import * as service from '../lib/estimate-service';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log('ok -', msg);
  } else {
    failed++;
    console.error('FAIL -', msg);
  }
}

assert(money.parseMajorToMinor('10.99') === 1099, 'parse 10.99');
assert(money.lineAmountMinor(3, 3333) === 9999, 'line amount');
assert(money.sumMinor([100, 200]) === 300, 'sum');
assert(money.formatMinorUnits(125099, 'USD').includes('1,250.99'), 'format');
assert(lifecycle.canTransition('draft', 'send'), 'draft->send');
assert(!lifecycle.canTransition('draft', 'accept'), 'no draft->accept');
assert(lifecycle.nextStatus('sent', 'reject') === 'rejected', 'sent->reject');
assert(lifecycle.isEditableStatus('draft'), 'draft editable');
const t = service.computeEstimateTotals(
  [{ description: 'A', quantity: 2, unit_amount_minor: 500 }],
  100,
);
assert(t.total_minor === 1100, 'totals');
assert(service.applyLifecycleTransition('draft', 'send').status === 'sent', 'lifecycle stamp');
try {
  service.assertCanSoftDelete('sent', null);
  assert(false, 'soft delete sent should throw');
} catch {
  assert(true, 'soft delete sent blocked');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
