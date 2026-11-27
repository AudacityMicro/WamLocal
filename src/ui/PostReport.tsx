import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PostedFile } from "../core/postprocessor";
import { useDisplayUnits } from "./display-units";
export type PostReportData = {
  title: string;
  files?: string[];
  issues: string[];
  estimates?: PostedFile[];
};
export function PostReport({
  report,
  onClose,
}: {
  report: PostReportData;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const units = useDisplayUnits();
  const duration = (seconds: number) => {
    const n = Math.ceil(seconds);
    return `${Math.floor(n / 60)}m ${n % 60}s`;
  };
  const money = (n: number | null, currency: string) =>
    n === null ? "Not configured" : `${currency} ${n.toFixed(2)}`;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="nesting-settings-dialog post-report-dialog"
      aria-label={report.title}
      onCancel={onClose}
    >
      <h2>{report.title}</h2>
      {report.estimates?.length ? (
        <>
          <table>
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Time</th>
                <th>Pierces</th>
                <th>Abrasive</th>
                <th>Abrasive cost</th>
                <th>Running cost</th>
                <th>Total cost</th>
              </tr>
            </thead>
            <tbody>
              {report.estimates.map((f) => (
                <tr key={f.sheetId}>
                  <td>{f.sheetName}</td>
                  <td>{duration(f.seconds)}</td>
                  <td>{f.operations}</td>
                  <td>
                    {units.unit === "in"
                      ? `${(f.abrasiveGrams / 453.59237).toFixed(3)} lb`
                      : `${f.abrasiveGrams.toFixed(1)} g`}
                  </td>
                  <td>{money(f.cost.abrasive, f.cost.currency)}</td>
                  <td>{money(f.cost.running, f.cost.currency)}</td>
                  <td>{money(f.cost.total, f.cost.currency)}</td>
                </tr>
              ))}
              {report.estimates.length > 1 ? (
                <tr>
                  <th>Total</th>
                  <td>
                    {duration(
                      report.estimates.reduce((n, f) => n + f.seconds, 0),
                    )}
                  </td>
                  <td>
                    {report.estimates.reduce((n, f) => n + f.operations, 0)}
                  </td>
                  <td>
                    {units.unit === "in"
                      ? `${(report.estimates.reduce((n, f) => n + f.abrasiveGrams, 0) / 453.59237).toFixed(3)} lb`
                      : `${report.estimates.reduce((n, f) => n + f.abrasiveGrams, 0).toFixed(1)} g`}
                  </td>
                  <td colSpan={3}>
                    {report.estimates.every(
                      (f) =>
                        f.cost.total !== null &&
                        f.cost.currency === report.estimates![0].cost.currency,
                    )
                      ? money(
                          report.estimates.reduce(
                            (n, f) => n + f.cost.total!,
                            0,
                          ),
                          report.estimates[0].cost.currency,
                        )
                      : "Configure all rates in one currency for a combined cost"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <p>
            Cutting:{" "}
            {duration(report.estimates.reduce((n, f) => n + f.cutSeconds, 0))} ·
            Piercing:{" "}
            {duration(
              report.estimates.reduce((n, f) => n + f.pierceSeconds, 0),
            )}{" "}
            · Stop dwells:{" "}
            {duration(
              report.estimates.reduce((n, f) => n + f.overheadSeconds, 0),
            )}
          </p>
          <p className="micro">
            Estimates include cutting, pierces and programmed stop dwells.
            Abrasive includes its stop dwell before shutoff. Rapid travel,
            acceleration, setup, sheet changes and stock costs are excluded.
            Rates come from the job's machine settings.
          </p>
        </>
      ) : null}
      {report.files?.map((file) => (
        <p key={file}>
          <code>{file}</code>
        </p>
      ))}
      {report.issues.length ? (
        <ul>
          {report.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <button onClick={onClose}>Close</button>
    </dialog>,
    document.body,
  );
}
