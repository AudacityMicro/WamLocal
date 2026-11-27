import type { JobMaterial } from "./job";
import { materialName, materialQuality } from "./material-selection";
import { estimateMaterialSettings } from "./material-estimate";
import { materialFeedCorrections } from "./material-feed-corrections";

/** Upgrade generated records only. User presets and saved job snapshots are not inputs here. */
export function repairMaterialProfiles(
  materials: JobMaterial[],
): JobMaterial[] {
  return materials.map((m) => {
    if (
      m.processRevision === 1 ||
      m.source?.startsWith("User-edited") ||
      m.source?.startsWith("Saved job")
    )
      return m;
    const name = materialName(m),
      quality = materialQuality(m);
    if (quality === "custom") return m;
    const generated =
      /^(WAM |No exact WAM|Nominal sheet gauge|Acrylic process proxy)/.test(
        m.source ?? "",
      );
    if (!generated) return m;
    const correction = materialFeedCorrections.find(
      (c) =>
        c.machine === m.machine &&
        c.name === name &&
        Math.abs(c.thicknessMm - m.thickness) < 1e-7 &&
        c.quality === quality,
    );
    if (
      correction &&
      (Math.abs(m.feed - correction.previousFeed) < 0.021 ||
        Math.abs(m.feed - correction.feed) < 0.021)
    )
      return {
        ...m,
        feed: correction.feed,
        processRevision: 1,
        source: `Corrected captured feed ${correction.date}; ${m.source}`,
      };
    if (m.machine === "pro" && name === "EPDM - EPDM") {
      const oldFeed =
        quality === "coarse" ? 11.43 : quality === "medium" ? 10.16 : 8.89;
      try {
        const proxy = estimateMaterialSettings(m, m.thickness, quality);
        if (
          Math.abs(m.feed - oldFeed) < 0.021 ||
          Math.abs(m.feed - proxy.feed) < 0.021
        )
          return proxy;
      } catch {
        /* A missing donor never triggers an invented process value. */
      }
    }
    if (
      m.feed === 100 &&
      m.requiresVerification &&
      m.source?.startsWith("No exact WAM") &&
      name !== "Custom material"
    ) {
      try {
        return {
          ...estimateMaterialSettings(m, m.thickness, quality),
          processRevision: 1,
        };
      } catch {
        /* Keep explicit missing settings if no bounded estimate exists. */
      }
    }
    // The foam's constant low feed is present in the source but remains unvalidated.
    if (m.machine === "pro" && name === "Polyethylene Foam - 4lb")
      return {
        ...m,
        requiresVerification: true,
        preset: undefined,
        processRevision: 1,
        source: `Unvalidated constant source feed for polyethylene foam; enter measured cutting values. ${m.source}`,
      };
    return m;
  });
}
