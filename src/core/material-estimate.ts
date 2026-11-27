import {
  materialPresets,
  type MaterialPreset,
  type CutQuality,
} from "./material-presets";
import { materialName } from "./material-selection";
import { jobMaterialSchema, type JobMaterial } from "./job";
import { feedCaptures } from "./material-feed-corrections";
import { defaultTabWidth } from "./tab-defaults";

import {
  monotoneInterpolate,
  interpolateMaterialCurve,
} from "./material-interpolation";
export {
  monotoneInterpolate,
  interpolateMaterialCurve,
} from "./material-interpolation";
const referenceRows = new Map<string, MaterialPreset[]>();
for (const row of materialPresets) {
  const key = `${row.machine}|${row.name}`,
    group = referenceRows.get(key);
  if (group) group.push(row);
  else referenceRows.set(key, [row]);
}
for (const group of referenceRows.values())
  group.sort((a, b) => a.thicknessMm - b.thicknessMm);
const feedRows = new Map<string, (typeof feedCaptures)[number][]>();
for (const row of feedCaptures) {
  const key = `${row.machine}|${row.name}`,
    group = feedRows.get(key);
  if (group) group.push(row);
  else feedRows.set(key, [row]);
}
for (const group of feedRows.values())
  group.sort((a, b) => a.thicknessMm - b.thicknessMm);

export function estimateMaterialSettings(
  current: JobMaterial,
  thickness: number,
  quality: CutQuality,
  records: readonly MaterialPreset[] = materialPresets,
): JobMaterial {
  if (!Number.isFinite(thickness) || thickness <= 0)
    throw Error("Thickness must be positive and finite.");
  const stock = materialName(current),
    key = `${current.machine}|${stock}`;
  if (current.machine === "pro" && stock === "EPDM - EPDM") {
    const acrylic =
      records === materialPresets
        ? (referenceRows.get("pro|Acrylic - Acrylic") ?? [])
        : records
            .filter(
              (p) => p.machine === "pro" && p.name === "Acrylic - Acrylic",
            )
            .sort((a, b) => a.thicknessMm - b.thicknessMm);
    if (!acrylic.length)
      throw Error("No acrylic donor profiles are available for this machine.");
    const donorThickness = Math.max(
      acrylic[0].thicknessMm,
      Math.min(acrylic.at(-1)!.thicknessMm, thickness),
    );
    const donor = estimateMaterialSettings(
      { ...current, name: "Acrylic - Acrylic", stockKey: "Acrylic - Acrylic" },
      donorThickness,
      quality,
      records,
    );
    return jobMaterialSchema.parse({
      ...current,
      thickness,
      quality,
      feed: donor.feed,
      pierce: donor.pierce,
      lead: donor.lead,
      abrasive: donor.abrasive,
      tabWidth: defaultTabWidth(thickness),
      tabDefaultWidthMm: defaultTabWidth(thickness),
      preset: undefined,
      requiresVerification: true,
      processRevision: 1,
      source: `Acrylic process proxy for Pro EPDM at ${donorThickness} mm. ${Math.abs(donorThickness - thickness) > 1e-7 ? "Outside the acrylic reference range: nearest endpoint used without extrapolation. " : ""}Review this material substitution before cutting.`,
    });
  }
  const rows =
    records === materialPresets
      ? (referenceRows.get(key) ?? [])
      : records
          .filter((p) => p.machine === current.machine && p.name === stock)
          .sort((a, b) => a.thicknessMm - b.thicknessMm);
  const exact = rows.find((p) => Math.abs(p.thicknessMm - thickness) < 1e-7);
  const feeds = feedRows.get(key) ?? [];
  const recordedFeed = feeds.find(
    (p) => Math.abs(p.thicknessMm - thickness) < 1e-7,
  );
  const onlyRecordedFeed = () =>
    jobMaterialSchema.parse({
      ...current,
      thickness,
      quality,
      feed: recordedFeed!.feeds[quality],
      preset: undefined,
      requiresVerification: true,
      source: `WAM ${current.machine === "pro" ? "Pro" : "Desktop"} demo feed capture 2026-11-17. Nominal feed is recorded; remaining process values are unchanged and require review.`,
    });
  if (!rows.length) {
    const recorded = feeds.find(
      (p) => Math.abs(p.thicknessMm - thickness) < 1e-7,
    );
    const hiFeed = feeds.findIndex((p) => p.thicknessMm > thickness);
    if (!recorded && hiFeed <= 0)
      throw Error(
        "No same-machine WAM references bracket this thickness. Extrapolation and cross-machine scaling are unavailable.",
      );
    const lower = recorded ?? feeds[hiFeed - 1],
      upper = recorded ?? feeds[hiFeed];
    if (!recorded && upper.thicknessMm / lower.thicknessMm > 2.01)
      throw Error(
        "WAM feed references are too widely spaced. Add a closer capture.",
      );
    const feed =
      recorded?.feeds[quality] ??
      Math.exp(
        monotoneInterpolate(
          feeds.map((p) => Math.log(p.thicknessMm)),
          feeds.map((p) => Math.log(p.feeds[quality])),
          Math.log(thickness),
        ),
      );
    return jobMaterialSchema.parse({
      ...current,
      thickness,
      quality,
      feed: Number(feed.toFixed(2)),
      preset: undefined,
      requiresVerification: true,
      source: recorded
        ? `WAM ${current.machine === "pro" ? "Pro" : "Desktop"} demo feed capture 2026-11-17. Nominal feed is recorded; remaining process values require review.`
        : `Estimated ${current.machine} feed from same-machine WAM captures at ${lower.thicknessMm} and ${upper.thicknessMm} mm. Remaining process values are unchanged and require review.`,
    });
  }
  const hi = rows.findIndex((p) => p.thicknessMm > thickness);
  if (!exact && hi <= 0 && recordedFeed) return onlyRecordedFeed();
  if (!exact && hi <= 0)
    throw Error(
      "No same-machine WAM references bracket this thickness. Extrapolation and cross-machine scaling are unavailable.",
    );
  const a = exact ?? rows[hi - 1],
    b = exact ?? rows[hi];
  if (!exact && b.thicknessMm / a.thicknessMm > 2.01 && recordedFeed)
    return onlyRecordedFeed();
  if (!exact && b.thicknessMm / a.thicknessMm > 2.01)
    throw Error(
      "WAM references are too widely spaced for this thickness. Add a closer capture.",
    );
  const values = exact ?? interpolateMaterialCurve(rows, thickness);
  const tabInvalid = values.lead > 30;
  const range = exact
    ? `Exact WAM reference ${exact.id}`
    : `Estimated from WAM ${current.machine} references at ${a.thicknessMm} and ${b.thicknessMm} mm. Shape-preserving cubic interpolation: log-log feeds/tab width, linear-thickness pierce, log-thickness lead. Not a WAM measurement; review and test before use.`;
  return jobMaterialSchema.parse({
    ...current,
    thickness,
    quality,
    feed: exact
      ? values.feeds[quality]
      : recordedFeed
        ? recordedFeed.feeds[quality]
        : Number(values.feeds[quality].toFixed(2)),
    pierce: Number(values.pierce.toFixed(2)),
    abrasive: values.abrasive,
    tabWidth: defaultTabWidth(thickness),
    tabDefaultWidthMm: defaultTabWidth(thickness),
    lead: tabInvalid ? current.lead : Number(values.lead.toFixed(2)),
    preset:
      exact && !exact.requiresProcessReview && !tabInvalid
        ? { id: exact.id, quality }
        : undefined,
    requiresVerification: !exact || !!exact.requiresProcessReview || tabInvalid,
    source:
      (!exact && recordedFeed
        ? `WAM ${current.machine === "pro" ? "Pro" : "Desktop"} demo feed capture 2026-11-17. Nominal feed is recorded. Other parameters: `
        : "") +
      range +
      (tabInvalid
        ? " Invalid captured tab/lead defaults were retained as job defaults and require review."
        : ""),
  });
}
