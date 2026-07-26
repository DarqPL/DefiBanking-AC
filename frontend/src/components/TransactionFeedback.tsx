type TransactionFeedbackProps = {
  status?: string
  success?: string
  error?: string
}

export function TransactionFeedback({ status, success, error }: TransactionFeedbackProps) {
  if (!status && !success && !error) return null

  const tone = error ? 'error' : success ? 'success' : 'status'
  const message = error ?? success ?? status

  return (
    <aside className={`transaction-feedback transaction-feedback-${tone}`} role={error ? 'alert' : 'status'}>
      <span className="transaction-feedback-dot" aria-hidden="true" />
      <div>
        <strong>{error ? 'Transaction needs attention' : success ? 'Transaction complete' : 'Transaction in progress'}</strong>
        <p>{message}</p>
      </div>
    </aside>
  )
}
