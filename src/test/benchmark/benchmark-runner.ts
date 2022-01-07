import { sleep } from "../../util/misc";

// run node with --expose-gc to make this do anything
let gc = global.gc || (() => {});

type TestName = string;
type ScenarioName = string;
type TestNameToMsPerIter = Record<TestName, number | null>;
type ScenarioNameToTests = Record<string, TestNameToMsPerIter>;

type Log = (...args: any[]) => void;

export class BenchmarkRunner {
    data: ScenarioNameToTests = {}; // scenario --> testName --> ms per iter
    currentScenario: string = "";
    log: Log;
    constructor(log: Log) {
        this.log = log;
        let timestampString = (new Date()).toISOString();
        this.note(timestampString);
    }
    note(msg: string) {
        this.log(msg);
    }
    setScenario(scenario: ScenarioName) {
        this.log("");
        this.log(`> ${scenario}`);
        this.log(`  > ops/sec`);
        this.currentScenario = scenario;
    }
    _startRun(testName: TestName) {
    }
    _finishRun(testName: TestName, msPerOp: number, err?: any) {
        let maxChars = 11;
        if (err) {
            let result = "ERROR".padStart(maxChars, " ");
            this.log(`  > ${result}: ${testName}`);
            this.log(err);
        } else {
            let opsPerSec = 1000 / msPerOp;
            let result = Number(Math.round(opsPerSec)).toLocaleString("en-US")
                .padStart(maxChars, " ");
            this.log(`  > ${result}:  ${testName}`);
        }

        if (this.data[this.currentScenario] === undefined) {
            this.data[this.currentScenario] = {};
        }
        this.data[this.currentScenario][testName] = msPerOp;
    }
    async runOnce(
        testName: TestName,
        opts: { actualIters?: number },
        fn: () => void | Promise<void>,
    ): Promise<void> {
        await sleep(1);
        this._startRun(testName);
        gc();
        try {
            let start = Date.now();
            let prom = fn();
            if (prom instanceof Promise) {
                await prom;
            }
            let end = Date.now();
            let ms = (end - start) / (opts.actualIters || 1);
            this._finishRun(testName, ms);
        } catch (err) {
            this._finishRun(testName, -1, err);
        }
    }
    async runMany(
        testName: TestName,
        opts: { minDuration?: number },
        fn: () => void | Promise<void>,
    ): Promise<void> {
        await sleep(1);
        this._startRun(testName);
        gc();
        try {
            let start = Date.now();
            let ii = 1;
            let minDuration = opts.minDuration || 2000;
            let minIters = 3;
            while (true) {
                let prom = fn();
                if (prom instanceof Promise) {
                    await prom;
                }
                let now = Date.now();
                if (ii >= minIters && now - start > minDuration) break;
                ii++;
            }
            let end = Date.now();
            let ms = (end - start) / ii;
            this._finishRun(testName, ms);
        } catch (err) {
            this._finishRun(testName, -1, err);
        }
    }
}
