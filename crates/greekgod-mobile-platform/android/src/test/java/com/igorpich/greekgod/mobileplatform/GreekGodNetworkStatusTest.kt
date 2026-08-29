package com.igorpich.greekgod.mobileplatform

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GreekGodNetworkStatusTest {
    @Test
    fun detectsWifiThatIsNotTheActiveInternetNetwork() {
        val networks = listOf(
            LocalNetworkTransport(wifi = false, ethernet = false),
            LocalNetworkTransport(wifi = true, ethernet = false),
        )

        assertTrue(hasLocalNetwork(networks))
    }

    @Test
    fun detectsEthernetAndRejectsNonLocalTransports() {
        assertTrue(hasLocalNetwork(listOf(LocalNetworkTransport(false, true))))
        assertFalse(hasLocalNetwork(listOf(LocalNetworkTransport(false, false))))
        assertFalse(hasLocalNetwork(emptyList()))
    }
}
