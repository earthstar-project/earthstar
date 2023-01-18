
/** A timeout which can be 'bumped' manually, restarting the timer. */
export class BumpingTimeout {
	private timeout: number;
	private cb: () => void;
	private ms: number;
	private closed = false;

	constructor(cb: () => void, ms: number) {
		this.cb = cb;
		this.ms = ms;
		this.timeout = setTimeout(cb, ms);
	}

	bump() {
		if (this.closed) {
			return;
		}

		clearTimeout(this.timeout);
		this.timeout = setTimeout(this.cb, this.ms);
	}

	close() {
		this.closed = true;

		clearTimeout(this.timeout);
	}
}
