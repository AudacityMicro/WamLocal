import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { evaluateNumericExpression } from "../core/numeric-expression";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> & {
  value: number | "";
  onChange: (value: number) => void;
  onClear?: () => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  unit?: string;
  integer?: boolean;
};
/** Keep the user's decimal text while editing; only send complete, valid numbers
 * to the model. In particular, '.', '-', '0.' and trailing zeroes survive renders. */
export function NumericInput({
  value,
  onChange,
  onClear,
  min,
  max,
  step = "any",
  unit,
  integer = false,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const [draft, setDraft] = useState(String(value)),
    focused = useRef(false),
    latest = useRef(value),
    initial = useRef(value);
  const [error, setError] = useState("");
  const cancelled = useRef(false);
  latest.current = value;
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  const plain = (text: string) =>
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim());
  const parse = (text: string) => {
    try {
      return evaluateNumericExpression(text, unit);
    } catch {
      return NaN;
    }
  };
  const valid = (n: number) =>
    Number.isFinite(n) &&
    (!integer || Number.isInteger(n)) &&
    (min === undefined || n >= Number(min) - 1e-10) &&
    (max === undefined || n <= Number(max) + 1e-10);
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      title={
        error ||
        props.title ||
        `Math and units supported${unit ? ` (display: ${unit})` : ""}. Enter to calculate; Escape to cancel.`
      }
      aria-invalid={error ? true : props["aria-invalid"]}
      role="spinbutton"
      aria-valuenow={value === "" ? undefined : value}
      aria-valuemin={min === undefined ? undefined : Number(min)}
      aria-valuemax={max === undefined ? undefined : Number(max)}
      value={focused.current ? draft : String(value)}
      onFocus={(e) => {
        focused.current = true;
        initial.current = value;
        cancelled.current = false;
        setError("");
        setDraft(String(value));
        onFocus?.(e);
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        setError("");
        const n = plain(text) ? Number(text) : NaN;
        if (valid(n)) {
          latest.current = n;
          onChange(n);
        }
      }}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
        } else if (!draft.trim() && onClear) {
          onClear();
          latest.current = "";
        } else {
          const n = parse(draft);
          if (valid(n)) {
            if (n !== latest.current) onChange(n);
            latest.current = n;
          } else if (draft.trim() && !/^[+\-.]?$/.test(draft.trim())) {
            let message = "";
            try {
              evaluateNumericExpression(draft, unit);
              message = integer
                ? "Enter a whole number within the allowed range."
                : "Result is outside the allowed range.";
            } catch (error) {
              message = (error as Error).message;
            }
            setError(message);
            if (latest.current !== initial.current) {
              if (initial.current === "") onClear?.();
              else onChange(initial.current);
              latest.current = initial.current;
            }
          }
        }
        focused.current = false;
        setDraft(String(latest.current));
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = true;
          setError("");
          if (initial.current === "") onClear?.();
          else onChange(initial.current);
          latest.current = initial.current;
          setDraft(String(initial.current));
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const parsed = parse(draft),
            base = valid(parsed) ? parsed : Number(value || 0);
          const increment = Number(step) > 0 ? Number(step) : 1;
          const n = Math.max(
            min === undefined ? -Infinity : Number(min),
            Math.min(
              max === undefined ? Infinity : Number(max),
              Number(
                (
                  base + (e.key === "ArrowUp" ? increment : -increment)
                ).toPrecision(14),
              ),
            ),
          );
          if (valid(n)) {
            setDraft(String(n));
            latest.current = n;
            setError("");
            onChange(n);
          }
        }
        onKeyDown?.(e);
      }}
    />
  );
}
