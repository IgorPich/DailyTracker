import { formatNumber } from '../utils/calculations'
import { formatShortDate } from '../utils/date'

interface PayloadItem {
  dataKey?: string
  value?: number
  color?: string
}

export function WeightTooltip({ active, payload, label }: {
  active?: boolean
  payload?: PayloadItem[]
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="chart-tooltip">
      <strong>{formatShortDate(label)}</strong>
      {payload.map((item) => (
        <div key={item.dataKey}>
          <span style={{ background: item.color }} />
          {item.dataKey === 'movingAverage' ? 'Średnia 7 dni' : 'Masa'}: {formatNumber(item.value)} kg
        </div>
      ))}
    </div>
  )
}
