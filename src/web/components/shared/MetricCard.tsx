export function MetricCard(props: { title: string; value: string; note?: string }) {
  return (
    <article className="metric-card">
      <div className="metric-title">{props.title}</div>
      <div className="metric-value">{props.value}</div>
      {props.note ? <div className="metric-note">{props.note}</div> : null}
    </article>
  );
}
