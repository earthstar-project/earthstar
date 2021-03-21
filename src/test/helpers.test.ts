import t = require('tap');
//t.runOnly = true;

import {
    isPlainObject,
    objWithoutUndefined,
    range,
    sorted,
    stringMult,
    uniq,
} from '../util/helpers';

//================================================================================

t.test('isPlainObject', (t: any) => {
    class DogClass {
        constructor(public name: string) {
        }
    }

    t.ok(isPlainObject({}), 'an actual object');

    // this is a questionable result, should a class instance
    // be considered a plain object?
    t.ok(isPlainObject(new DogClass('Fido')), 'a class instance');

    // things that are not plain objects
    t.notOk(isPlainObject(DogClass), 'a class itself');
    t.notOk(isPlainObject(false), 'false');
    t.notOk(isPlainObject([]), 'array');
    t.notOk(isPlainObject(null), 'null');
    t.notOk(isPlainObject(undefined), 'undefined');
    t.notOk(isPlainObject('hello'), 'string');

    t.done();
});

t.test('range', (t: any) => {
    t.same(range(0), []);
    t.same(range(1), [0]);
    t.same(range(2), [0, 1]);
    t.same(range(3), [0, 1, 2]);
    t.done();
});

t.test('stringMult', (t: any) => {
    t.same(stringMult('x', 5), 'xxxxx');
    t.same(stringMult('abc', 2), 'abcabc');
    t.same(stringMult('f', 0), '');
    t.same(stringMult('- ', 3), '- - - ');
    t.done();
});

t.test('uniq', (t: any) => {
    let words = 'z apple banana apple cherry cupcake grape grape z'.split(' ');
    let uniqued = 'z apple banana cherry cupcake grape'.split(' ');
    t.same(uniq(words), uniqued);
    t.same(uniq([]), []);
    t.same(uniq(['a']), ['a']);
    t.done();
});

t.test('sorted', (t: any) => {
    let words = 'z apple banana cherry cupcake grape'.split(' ');
    let correctlySorted = 'apple banana cherry cupcake grape z'.split(' ');
    let result = sorted(words);
    t.same(result, correctlySorted);
    t.same(words[0], 'apple', 'original was modified');
    t.done();
});

t.test('objWithoutUndefined', (t: any) => {
    let cases: [any, any][] = [
        // input, desired output
        [{a: 1}, {a: 1}],
        [{a: 1, b: undefined}, {a: 1}],
        [{b: undefined}, {}],
    ]
    for (let [inpt, goal] of cases) {
        let result = objWithoutUndefined(inpt);
        t.same(result, goal);
    }
    t.done();
});
