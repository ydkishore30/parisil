/** Append-only time series with cheap trimming from the front. */
export class Series {
  t = new Float64Array(1024);
  v = new Float64Array(1024);
  start = 0;
  end = 0;

  get length(): number {
    return this.end - this.start;
  }

  push(t: number, v: number): void {
    if (this.end === this.t.length) {
      if (this.start > this.t.length / 2) {
        this.t.copyWithin(0, this.start, this.end);
        this.v.copyWithin(0, this.start, this.end);
      } else {
        const size = this.t.length * 2;
        const nt = new Float64Array(size);
        const nv = new Float64Array(size);
        nt.set(this.t.subarray(this.start, this.end));
        nv.set(this.v.subarray(this.start, this.end));
        this.t = nt;
        this.v = nv;
      }
      this.end -= this.start;
      this.start = 0;
    }
    this.t[this.end] = t;
    this.v[this.end] = v;
    this.end++;
  }

  clear(): void {
    this.start = this.end = 0;
  }

  /** First index whose time is >= t (in [start, end]). */
  lowerBound(t: number): number {
    let lo = this.start;
    let hi = this.end;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  trimBefore(t: number): void {
    this.start = this.lowerBound(t);
  }

  /** Index of the sample closest in time to t, or -1 when empty. */
  nearest(t: number): number {
    if (this.end === this.start) return -1;
    const i = this.lowerBound(t);
    if (i <= this.start) return this.start;
    if (i >= this.end) return this.end - 1;
    return t - this.t[i - 1] <= this.t[i] - t ? i - 1 : i;
  }
}
