import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
export type PostReportData = {
  title: string;
  files?: string[];
  issues: string[];
};
export function PostReport({
  report,
  onClose,
}: {
  report: PostReportData;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="nesting-settings-dialog"
      aria-label={report.title}
      onCancel={onClose}
    >
      <h2>{report.title}</h2>
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
