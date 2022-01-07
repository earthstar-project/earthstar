import { fast_deep_equal as deepEqual, Superbus } from "../../deps.ts";

//let log = console.log;
let log = (...args: any[]) => {};
let mapdebug = "        🗺";

/*
 *   SuperbusMap
 *
 *   This is almost identical to the built-in Map class except:
 *      - You can subscribe to events when the data changes
 *      - The write functions (set, delete, clear) are async
 *         so that the event callbacks have time to finish running.
 *      - Keys must be strings
 *      - set(key, value) returns a string describing what happened
 *
 *   The "events" property is a Superbus instance with events you can subscribe to:
 *
 *      myMap.events.on('changed', (channel, data) => {
 *          // channel will be 'changed:${key}'
 *          // data will be { key, value, oldValue }
 *      });
 *
 *   The key is included in the event channel name, separated after a ':'.
 *
 *      Event channel     Event data
 *      -------------     ---------------
 *      "added:$KEY"      { key, value           }
 *      "changed:$KEY"    { key, value, oldValue }
 *      "deleted:$KEY"    { key,        oldValue }
 *
 *   The Superbus class will also let you receive these events for all keys
 *    by subscribing to just "added", "changed", or "deleted".
 *   You can also subscribe to "*" to get all events.
 *
 *   (The ':' separator can be changed to another character or string
 *    using the "sep" argument in the constructor.)
 *
 *   The events are sent using Superbus.sendAndWait which allows the
 *    entire system to wait for all the event handlers to finish running
 *    before proceeding, including synchronous and async handlers.
 *   For this to work you must "await" the write methods
 *    of SuperbusMap (set, delete, clear).
 *   In other words,
 *
 *       // set a value...
 *       await myMap.set('hello', 'world');
 *       // at this point all the event handlers are guaranteed to
 *       // have finished running.
 *
 *       // without using await...
 *       myMap.set('hello', 'world?');
 *       // at this point only the synchronous event handlers have
 *       // finished running.  The async ones are still running.
 *       // but at least the map.set itself has definitely finished.
 *
 *  The "await" is only important if you want to make sure
 *   the event handlers have finished running.
 *  Even if you don't use await, the actual changes to the Map
 *   will be complete by the time the method exits.
 *
 *  The exception is clear(), which deletes items one by one and
 *  waits for their event handlers.  You must "await map.clear()"
 *  to ensure everything is deleted before your next
 *  line of code runs.
 */

export type SuperbusMapEvents = "added" | "changed" | "deleted";

export class SuperbusMap<K extends string, V> {
    bus: Superbus<string>;
    _map: Map<K, V>;
    _sep: string; // character used to separate channel name from id, like 'changed:123'
    constructor(
        mapToClone?:
            | SuperbusMap<K, V>
            | Map<K, V>
            | Array<[K, V]>
            | Iterable<[K, V]>
            | null
            | undefined,
        sep: string = ":",
    ) {
        this._sep = sep;
        if (mapToClone instanceof SuperbusMap) {
            // note we don't copy the sep char from the other cloned superbusMap
            this._map = new Map<K, V>(mapToClone._map);
        } else if (mapToClone != null) {
            this._map = new Map<K, V>(mapToClone);
        } else {
            this._map = new Map<K, V>();
        }

        this.bus = new Superbus<string>(sep);
    }
    // WRITE
    async set(key: K, value: V): Promise<"added" | "changed" | "unchanged"> {
        // return:
        //   if new, 'added'
        //   if changed, 'changed'
        //   if same as before, 'unchanged'
        log(`${mapdebug} set("${key}", ${JSON.stringify(value)})`);
        let oldValue = this.get(key);
        this._map.set(key, value);
        if (oldValue === undefined) {
            await this.bus.sendAndWait("added" + this._sep + key, {
                key,
                value,
            });
            return "added";
        } else {
            if (!deepEqual(value, oldValue)) {
                // only send 'changed' when the data is actually different
                await this.bus.sendAndWait("changed" + this._sep + key, {
                    key,
                    value,
                    oldValue,
                });
                return "changed";
            } else {
                // no event is sent for this
                return "unchanged";
            }
        }
    }
    async clear(): Promise<void> {
        log(`${mapdebug} clear()`);
        for (let key of this.keys()) {
            await this.delete(key);
        }
    }
    async delete(key: K): Promise<boolean> {
        log(`${mapdebug} delete("${key}")`);
        let oldValue = this.get(key);
        if (oldValue === undefined) {
            log(`${mapdebug} ...delete("${key}") - already gone`);
            return false;
        }
        this._map.delete(key);
        await this.bus.sendAndWait("deleted" + this._sep + key, {
            key,
            oldValue,
        });
        return true;
    }
    // READ
    get size(): number {
        return this._map.size;
    }
    get(key: K): V | undefined {
        return this._map.get(key);
    }
    has(key: K): boolean {
        return this._map.has(key);
    }
    keys() {
        return this._map.keys();
    }
    values() {
        return this._map.values();
    }
    entries() {
        return this._map.entries();
    }
    forEach(cb: (value: V, key: K) => void) {
        this._map.forEach(cb);
    }
}

// all about Maps

// WRITE
// set(k, v): this
// clear(): void
// delete(): boolean

// READ
// map.size
// get(k): v | undefined
// has(k): boolean

// ITERATION
// for (let [key, value] of myMap) {}
// for (let key of myMap.keys()) {}
// for (let value of myMap.values()) {}
// for (let [k, v] of myMap.entries()) {}

// ARRAYS
// let arr = [[k1, v1], [k2, v2]]
// let myMap = new Map(arr);
// let arr2 = Array.from(myMap)
// let arr3 = [...myMap]
//
// keys, values are iterators, not arrays
// [...myMap.keys()]
// Array.from(myMap.keys())

// CLONE
// new Map(originalMap)

// MERGE
// new Map([...map1, ...map2wins, [anotherKey, anotherVal]]);
