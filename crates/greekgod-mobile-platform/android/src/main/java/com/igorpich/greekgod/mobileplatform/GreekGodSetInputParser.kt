package com.igorpich.greekgod.mobileplatform

internal object GreekGodSetInputParser {
    data class ParsedSet(val weight: Double, val reps: Int) {
        val normalized: String
            get() {
                val formattedWeight = if (weight % 1.0 == 0.0) weight.toInt().toString()
                else weight.toString().trimEnd('0').trimEnd('.')
                return "$formattedWeight × $reps"
            }
    }

    private val pattern = Regex(
        "^\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:[x×]|\\s)\\s*(\\d+)\\s*$",
        RegexOption.IGNORE_CASE,
    )

    fun parse(raw: String): ParsedSet? {
        val match = pattern.matchEntire(raw) ?: return null
        val weight = match.groupValues[1].replace(',', '.').toDoubleOrNull()
        val reps = match.groupValues[2].toIntOrNull()
        if (weight == null || !weight.isFinite() || weight < 0 || reps == null || reps <= 0) {
            return null
        }
        return ParsedSet(weight, reps)
    }
}
