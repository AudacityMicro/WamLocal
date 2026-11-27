import raw from "./material-feed-captures.json";
import corrections from "./material-feed-corrections.json";
export const materialFeedCorrections = corrections;
/** Preserve original capture evidence; use reviewed overrides in runtime lookups. */
export const feedCaptures = raw.map((c) => {
  const applicable = corrections.filter(
    (x) =>
      x.machine === c.machine &&
      x.name === c.name &&
      Math.abs(x.thicknessMm - c.thicknessMm) < 1e-7,
  );
  if (!applicable.length) return c;
  const feeds = { ...c.feeds };
  for (const correction of applicable)
    feeds[correction.quality as keyof typeof feeds] = correction.feed;
  return { ...c, feeds };
});
