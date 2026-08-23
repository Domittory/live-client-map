/**
 * In-memory metrics registry (ticket 62). Aggregate counters and histograms,
 * exported in Prometheus text format from /api/metrics. No label ever carries a
 * client or organization identifier — only fixed, safe dimension values (e.g. an
 * AI run status, an HTTP status class). Single-instance only; a multi-instance
 * deployment must replace this with a shared collector.
 */

interface Counter {
  name: string;
  help: string;
  series: Map<string, number>;
}

interface Histogram {
  name: string;
  help: string;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function labelKey(labels: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
  );
}

function renderLabels(key: string): string {
  const labels = JSON.parse(key) as Record<string, string>;
  return Object.entries(labels)
    .map(([name, value]) => `${name}="${value}"`)
    .join(",");
}

function ensureCounter(name: string, help: string): Counter {
  let counter = counters.get(name);
  if (!counter) {
    counter = { name, help, series: new Map() };
    counters.set(name, counter);
  }
  return counter;
}

function ensureHistogram(name: string, help: string, buckets: number[]): Histogram {
  let histogram = histograms.get(name);
  if (!histogram) {
    const sorted = [...buckets].sort((a, b) => a - b);
    histogram = { name, help, buckets: sorted, counts: sorted.map(() => 0), sum: 0, count: 0 };
    histograms.set(name, histogram);
  }
  return histogram;
}

/** Increment a labeled counter (labels are safe, fixed dimensions). */
export function incrementCounter(
  name: string,
  help: string,
  labels: Record<string, string> = {}
): void {
  const counter = ensureCounter(name, help);
  const key = labelKey(labels);
  counter.series.set(key, (counter.series.get(key) ?? 0) + 1);
}

/** Record an observation into a histogram. */
export function observeHistogram(
  name: string,
  help: string,
  buckets: number[],
  value: number
): void {
  const histogram = ensureHistogram(name, help, buckets);
  histogram.count += 1;
  histogram.sum += value;
  for (let i = 0; i < histogram.buckets.length; i += 1) {
    if (value <= histogram.buckets[i]) histogram.counts[i] += 1;
  }
}

/** Render all metrics in Prometheus text exposition format. */
export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [name, counter] of counters) {
    lines.push(`# HELP ${name} ${counter.help}`);
    lines.push(`# TYPE ${name} counter`);
    if (counter.series.size === 0) {
      lines.push(`${name} 0`);
    } else {
      for (const [key, value] of counter.series) {
        lines.push(`${name}{${renderLabels(key)}} ${value}`);
      }
    }
  }
  for (const [name, histogram] of histograms) {
    lines.push(`# HELP ${name} ${histogram.help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (let i = 0; i < histogram.buckets.length; i += 1) {
      lines.push(`${name}_bucket{le="${histogram.buckets[i]}"} ${histogram.counts[i]}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${histogram.count}`);
    lines.push(`${name}_sum ${histogram.sum}`);
    lines.push(`${name}_count ${histogram.count}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Clear all metrics (tests only). */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
}
