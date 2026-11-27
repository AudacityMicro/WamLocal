import { canonicalStockName } from "./stock-name";
export const MATERIAL_FAMILIES = [
  "Plastic",
  "Metal",
  "Ceramics",
  "Rubbers",
  "Other",
] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];
type MaterialIdentity = {
  name: string;
  stockKey?: string;
  family?: MaterialFamily;
  materialClass?: string;
  grade?: string;
};
export function materialHierarchy(material: MaterialIdentity) {
  const name = canonicalStockName(
    material.stockKey ??
      material.name.replace(/\s*[·-]\s*(coarse|medium|fine)$/i, ""),
  );
  const [head, ...tail] = name.split(/\s+-\s+/),
    detail = tail.join(" - ");
  let family: MaterialFamily = "Other",
    materialClass = "",
    grade = detail || head;
  if (
    /^(aluminum|aluminium|stainless steel|steel|brass|copper|titanium|bronze|nickel)\b/i.test(
      head,
    )
  ) {
    family = "Metal";
    materialClass = head;
  } else if (/^(silicone|neoprene|epdm|rubber|polyurethane)\b/i.test(head)) {
    family = "Rubbers";
    materialClass = head.replace(/\s+foam$/i, "");
    if (!detail && /foam/i.test(head)) grade = "Foam";
  } else if (/^(glass|tile|granite|marble|ceramic)\b/i.test(head)) {
    family = "Ceramics";
    materialClass = /^(granite|marble)$/i.test(head) ? "Natural stone" : head;
  } else if (
    /^(acrylic|hdpe|ldpe|polycarbonate|polyethylene|polypropylene|abs|pvc|ptfe|delrin|nylon)\b/i.test(
      head,
    )
  ) {
    family = "Plastic";
    materialClass = head.replace(/\s+foam$/i, "");
    if (/foam/i.test(head)) grade = detail ? `${detail} Foam` : "Foam";
  } else if (/^(garolite|carbon fiber)\b/i.test(head)) {
    materialClass = "Composites";
    grade = detail || head;
  }
  return {
    family: material.family ?? family,
    materialClass: material.materialClass ?? materialClass,
    grade: material.grade ?? grade,
  };
}
