import { useEffect, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { decimalInputValue, normalizeDecimalInput } from '../utils/numbers'

interface DecimalInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number | undefined
  onValueChange: (value: number | undefined) => void
}

export function DecimalInput({ value, onValueChange, onBlur, onKeyDown, ...props }: DecimalInputProps) {
  const [text, setText] = useState(() => decimalInputValue(value))

  useEffect(() => {
    const parsed = normalizeDecimalInput(text)
    if (parsed !== value) setText(decimalInputValue(value))
  }, [value])

  const commit = () => {
    const parsed = normalizeDecimalInput(text)
    if (!text.trim()) {
      setText('')
      onValueChange(undefined)
      return
    }
    if (parsed === undefined) {
      setText(decimalInputValue(value))
      return
    }
    setText(decimalInputValue(parsed))
    onValueChange(parsed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    onKeyDown?.(event)
  }

  return <input
    {...props}
    type="text"
    inputMode="decimal"
    value={text}
    onChange={(event) => {
      const next = event.target.value
      setText(next)
      if (!next.trim()) onValueChange(undefined)
      else if (!/[.,]$/.test(next)) {
        const parsed = normalizeDecimalInput(next)
        if (parsed !== undefined) onValueChange(parsed)
      }
    }}
    onBlur={(event) => {
      commit()
      onBlur?.(event)
    }}
    onKeyDown={handleKeyDown}
  />
}
