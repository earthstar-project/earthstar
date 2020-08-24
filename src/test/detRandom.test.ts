import t = require('tap');
//t.runOnly = true;

import {
    detChoice,
    detInt,
    detRandom,
    detRange,
} from '../util/detRandom';

t.test('detRandom is deterministic', (t: any) => {
    t.same(detRandom('hello'), detRandom('hello'), 'detRandom is deterministic');
    t.end();
});

t.test('detRandom is in range 0-1', (t: any) => {
    // do 500 samples of detRandom and make sure it's in the range [0, 1]
    let min = 999999999;
    let max = -999999999;
    for (let ii = 0; ii < 500; ii++) {
        let val = detRandom('' + ii);
        min = Math.min(val, min);
        max = Math.max(val, max);
    }
    t.ok(min >= 0, 'min >= 0');
    t.ok(min < 0.1, 'min < 0.1');
    t.ok(max > 0.9, 'max > 0.9');
    t.ok(max <= 1, 'max <= 1');

    t.end();
});

t.test('detRange', (t: any) => {
    let val = detRange('abc', 17.4, 17.5);
    t.ok(val >= 17.4 && val <= 17.5, 'detRange is within expected range');
    t.end();
});

t.test('detInt', (t: any) => {
    let resultSet : Set<number> = new Set();
    for (let ii = 0; ii < 500; ii++) {
        let num = detInt('' + ii, 7, 9);  // integers between 7 and 9, inclusive
        resultSet.add(num);
    }
    let result = [...resultSet];
    result.sort();
    t.same(result, [7, 8, 9], 'all items were eventually chosen')
    t.end();
});

t.test('detChoose', (t: any) => {
    let results : {[k:string]: boolean} = {};
    let inputs = ['a', 'b', 'c']
    for (let ii = 0; ii < 500; ii++) {
        let choice = detChoice('' + ii, inputs);
        results[choice] = true;
    }
    let keys = Object.keys(results).sort();
    t.same(keys, inputs, 'all items were eventually chosen woo')
    t.end();
});
