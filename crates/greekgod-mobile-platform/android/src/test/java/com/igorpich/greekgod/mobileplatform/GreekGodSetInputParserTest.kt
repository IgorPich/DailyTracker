package com.igorpich.greekgod.mobileplatform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GreekGodSetInputParserTest {
    @Test
    fun acceptedLockScreenFormatsNormalizeIdentically() {
        for (input in listOf("34.5x8", "34.5 x 8", "34.5 8", "34,5x8", "34,5 × 8")) {
            assertEquals("34.5 × 8", GreekGodSetInputParser.parse(input)?.normalized)
        }
        assertEquals("34 × 8", GreekGodSetInputParser.parse("34x8")?.normalized)
    }

    @Test
    fun invalidOrIncompleteInputIsRejected() {
        for (input in listOf("", "34", "x8", "34x0", "-1x8", "34.5x8.5", "abc")) {
            assertNull(input, GreekGodSetInputParser.parse(input))
        }
    }
}
