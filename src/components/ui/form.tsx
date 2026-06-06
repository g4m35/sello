import type { ReactNode } from "react";

export function FormSection({
  title,
  desc,
  action,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section__head">
        <div>
          <div className="form-section__title">{title}</div>
          {desc && <div className="form-section__desc">{desc}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label && (
        <span className="field__label">
          <span>
            {label}
            {required && <span className="field__req">*</span>}
          </span>
          {hint && <span className="field__hint">{hint}</span>}
        </span>
      )}
      {children}
      {error && (
        <span className="field__error">{error}</span>
      )}
    </label>
  );
}
