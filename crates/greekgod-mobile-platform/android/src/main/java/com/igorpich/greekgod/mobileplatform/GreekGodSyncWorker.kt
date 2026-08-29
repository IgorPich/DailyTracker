package com.igorpich.greekgod.mobileplatform

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class GreekGodSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    companion object {
        const val DATABASE_PATH = "databasePath"
        const val SERVICE_ID = "serviceId"
        const val DEVICE_ID = "deviceId"
        const val APP_VERSION = "appVersion"
        private const val SERVICE_TYPE = "_greekgod-sync._tcp."

        init {
            System.loadLibrary("greekgod_mobile_lib")
        }

        @JvmStatic
        private external fun nativeSync(
            databasePath: String,
            serviceId: String,
            deviceId: String,
            appVersion: String,
            deviceToken: String,
            hostOverride: String,
        ): String
    }

    override fun doWork(): Result {
        val connectivity = applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val localNetwork = connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)?.let { capabilities ->
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            } == true
        } ?: return Result.retry()
        if (!connectivity.bindProcessToNetwork(localNetwork)) return Result.retry()

        return try {
            doBoundWork()
        } finally {
            connectivity.bindProcessToNetwork(null)
        }
    }

    private fun doBoundWork(): Result {
        val databasePath = inputData.getString(DATABASE_PATH) ?: return Result.failure()
        val serviceId = inputData.getString(SERVICE_ID) ?: return Result.failure()
        val deviceId = inputData.getString(DEVICE_ID) ?: return Result.failure()
        val appVersion = inputData.getString(APP_VERSION) ?: return Result.failure()
        val token = runCatching {
            GreekGodSecretVault.load(applicationContext, "sync:$serviceId")
        }.getOrNull() ?: return Result.failure()

        val initial = nativeSync(databasePath, serviceId, deviceId, appVersion, token, "")
        if (initial == "ok") return Result.success()
        if (initial == "pc_unavailable") {
            val discovered = discover(serviceId, 6_000)
            if (discovered != null) {
                val retried = nativeSync(
                    databasePath, serviceId, deviceId, appVersion, token, discovered
                )
                if (retried == "ok") return Result.success()
                return resultFor(retried)
            }
        }
        return resultFor(initial)
    }

    private fun resultFor(code: String) = when (code) {
        "pc_unavailable", "transport_failed" -> Result.retry()
        else -> Result.failure()
    }

    @Suppress("DEPRECATION")
    private fun discover(serviceId: String, timeoutMs: Long): String? {
        val manager = applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val latch = CountDownLatch(1)
        val result = AtomicReference<String?>()
        val resolving = AtomicBoolean(false)
        lateinit var listener: NsdManager.DiscoveryListener
        listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) = Unit
            override fun onServiceLost(info: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(type: String) = Unit
            override fun onStartDiscoveryFailed(type: String, code: Int) = latch.countDown()
            override fun onStopDiscoveryFailed(type: String, code: Int) = Unit
            override fun onServiceFound(info: NsdServiceInfo) {
                if (!info.serviceType.equals(SERVICE_TYPE, ignoreCase = true)
                    || !resolving.compareAndSet(false, true)) return
                manager.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(service: NsdServiceInfo, code: Int) {
                        resolving.set(false)
                    }

                    override fun onServiceResolved(service: NsdServiceInfo) {
                        val advertisedId = service.attributes["serviceId"]
                            ?.toString(StandardCharsets.UTF_8)
                        val rawHost = service.host?.hostAddress
                        if (advertisedId != serviceId || rawHost.isNullOrBlank()
                            || service.port !in 1..65_535) {
                            resolving.set(false)
                            return
                        }
                        val host = if (rawHost.contains(':'))
                            "[${rawHost.replace("%", "%25")}]" else rawHost
                        result.set("https://$host:${service.port}")
                        latch.countDown()
                    }
                })
            }
        }
        return try {
            manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            result.get()
        } catch (_: Exception) {
            null
        } finally {
            runCatching { manager.stopServiceDiscovery(listener) }
        }
    }
}
