import { formatNumber, type WeightChartPoint } from '../utils/calculations'
import { formatLongDate } from '../utils/date'

interface PayloadItem {
  dataKey?: string
  value?: number
  color?: string
  payload?: WeightChartPoint
}

export function WeightTooltip({ active, payload, label }: {
  active?: boolean
  payload?: PayloadItem[]
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const point = payload.find((item) => item.payload)?.payload
  return (
    <div className="chart-tooltip">
      <strong>{formatLongDate(label)}</strong>
      {payload.map((item) => (
        <div key={item.dataKey}>
          <span style={{ background: item.color }} />
          {item.dataKey === 'movingAverage' ? 'Średnia 7 dni' : 'Masa dzienna'}: {formatNumber(item.value)} kg
        </div>
      ))}
      {point && <>
        <p>Okres: {formatLongDate(point.windowFrom)} – {formatLongDate(point.windowTo)}</p>
        <p>Pomiary: {point.measurementCount}/7</p>
        <small>7 dni kalendarzowych do wybranego dnia włącznie. Brak pomiaru nie oznacza 0 kg.</small>
      </>}
    </div>
  )
}
