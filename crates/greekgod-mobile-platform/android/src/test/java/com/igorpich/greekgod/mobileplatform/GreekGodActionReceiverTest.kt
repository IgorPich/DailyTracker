package com.igorpich.greekgod.mobileplatform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GreekGodActionReceiverTest {
    @Test
    fun jsonNullDoesNotBecomeASetIdentifier() {
        assertNull(optionalJsonString(isJsonNull = true, value = "null"))
        assertNull(optionalJsonString(isJsonNull = false, value = ""))
        assertEquals("set-4", optionalJsonString(isJsonNull = false, value = "set-4"))
    }
}
