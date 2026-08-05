import React from 'react'

/**
 * FlagGatedPage — shared chrome for the 7 admin pages added in Q2-Q4.
 *
 * Replaces the duplicated `if (loading)` / `if (disabled)` blocks each
 * page rolled by hand. Pages now pass their loading + disabled state in
 * and render their content as children.
 *
 *   <FlagGatedPage
 *     title="Documents"
 *     disabledMessage="Disabled. Ask the admin to enable it."
 *     loading={loading}
 *     disabled={disabled}
 *   >
 *     ...page body...
 *   </FlagGatedPage>
 */
export default function FlagGatedPage({
  title,
  disabledMessage = 'Disabled. Ask the admin to enable it in settings.',
  loading = false,
  disabled = false,
  loadingLabel = 'LOADING…',
  children,
}) {
  if (loading) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-card-meta">{loadingLabel}</div>
      </div>
    )
  }
  if (disabled) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">{title}</h1>
          <div className="rs-greeting-sub">{disabledMessage}</div>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
