package com.igorpich.greekgod.mobileplatform

import android.app.Activity
import android.app.AlarmManager
import android.Manifest
import android.content.Intent
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

internal data class LocalNetworkTransport(
    val wifi: Boolean,
    val ethernet: Boolean,
)

internal fun hasLocalNetwork(transports: Iterable<LocalNetworkTransport>): Boolean =
    transports.any { it.wifi || it.ethernet }

@InvokeArg
class SecretPayload {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class SecretKeyPayload {
    lateinit var key: String
}

@InvokeArg
class DiscoveryPayload {
    lateinit var serviceId: String
    var timeoutMs: Long = 5_000
}

@InvokeArg
class AutoSyncPayload {
    lateinit var databasePath: String
    lateinit var serviceId: String
    lateinit var deviceId: String
    lateinit var appVersion: String
}

@InvokeArg
class RestTimerPayload {
    lateinit var databasePath: String
    lateinit var deviceId: String
    lateinit var workoutId: String
    lateinit var exerciseId: String
    lateinit var setId: String
    lateinit var templateLabel: String
    lateinit var exerciseLabel: String
    var previousLabel: String = "—"
    var durationSeconds: Long = 150
}

@TauriPlugin
class GreekGodMobilePlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val SYNC_SERVICE_TYPE = "_greekgod-sync._tcp."
    }

    @Command
    fun storeSecret(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretPayload::class.java)
            require(args.key.isNotBlank() && args.key.length <= 128 && args.value.isNotEmpty())
            GreekGodSecretVault.store(activity.applicationContext, args.key, args.value)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("Android Keystore could not store the GreekGod pairing secret", error)
        }
    }

    @Command
    fun loadSecret(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretKeyPayload::class.java)
            require(args.key.isNotBlank() && args.key.length <= 128)
            val response = JSObject()
            response.put("value", GreekGodSecretVault.load(activity.applicationContext, args.key))
            invoke.resolve(response)
        } catch (error: Exception) {
            invoke.reject("Android Keystore could not load the GreekGod pairing secret", error)
        }
    }

    @Command
    fun deleteSecret(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretKeyPayload::class.java)
            require(args.key.isNotBlank() && args.key.length <= 128)
            GreekGodSecretVault.delete(activity.applicationContext, args.key)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("Android Keystore could not delete the GreekGod pairing secret", error)
        }
    }

    @Command
    fun discoverSyncService(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(activity, Manifest.permission.NEARBY_WIFI_DEVICES)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.NEARBY_WIFI_DEVICES),
                39_176,
            )
            invoke.reject("Zezwól GreekGod znajdować komputer w sieci lokalnej i spróbuj ponownie")
            return
        }
        val args = try {
            invoke.parseArgs(DiscoveryPayload::class.java).also {
                require(it.serviceId.isNotBlank() && it.timeoutMs in 1_000..15_000)
            }
        } catch (error: Exception) {
            invoke.reject("Invalid GreekGod NSD discovery request", error)
            return
        }
        val manager = activity.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val handler = Handler(Looper.getMainLooper())
        val completed = AtomicBoolean(false)
        val resolving = AtomicBoolean(false)
        lateinit var listener: NsdManager.DiscoveryListener

        fun finish(baseUrl: String? = null, failure: Exception? = null) {
            if (!completed.compareAndSet(false, true)) return
            handler.removeCallbacksAndMessages(listener)
            runCatching { manager.stopServiceDiscovery(listener) }
            if (failure != null) {
                invoke.reject("GreekGod NSD discovery failed", failure)
            } else {
                invoke.resolve(JSObject().apply { put("baseUrl", baseUrl) })
            }
        }

        listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) =
                finish(failure = IllegalStateException("NSD start failed: $errorCode"))
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!serviceInfo.serviceType.equals(SYNC_SERVICE_TYPE, ignoreCase = true)
                    || !resolving.compareAndSet(false, true)) return
                @Suppress("DEPRECATION")
                manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        resolving.set(false)
                    }

                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val advertisedId = info.attributes["serviceId"]
                            ?.toString(StandardCharsets.UTF_8)
                        if (advertisedId != args.serviceId) {
                            resolving.set(false)
                            return
                        }
                        val rawHost = info.host?.hostAddress
                        if (rawHost.isNullOrBlank() || info.port !in 1..65_535) {
                            resolving.set(false)
                            return
                        }
                        val host = if (rawHost.contains(':'))
                            "[${rawHost.replace("%", "%25")}]" else rawHost
                        finish("https://$host:${info.port}")
                    }
                })
            }
        }
        handler.postDelayed({ finish() }, args.timeoutMs)
        try {
            manager.discoverServices(SYNC_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (error: Exception) {
            finish(failure = error)
        }
    }

    @Command
    fun networkStatus(invoke: Invoke) {
        try {
            val manager = activity.applicationContext
                .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val localNetwork = manager.allNetworks.firstOrNull { network ->
                manager.getNetworkCapabilities(network)?.let { capabilities ->
                    hasLocalNetwork(listOf(LocalNetworkTransport(
                        wifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
                        ethernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
                    )))
                } == true
            }
            val bound = localNetwork != null && manager.bindProcessToNetwork(localNetwork)
            invoke.resolve(JSObject().apply { put("localNetworkAvailable", bound) })
        } catch (error: Exception) {
            invoke.reject("GreekGod could not inspect local network state", error)
        }
    }

    @Command
    fun releaseLocalNetwork(invoke: Invoke) {
        try {
            val manager = activity.applicationContext
                .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            manager.bindProcessToNetwork(null)
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("GreekGod could not release the local network", error)
        }
    }

    @Command
    fun scheduleAutoSync(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AutoSyncPayload::class.java)
            require(args.databasePath.isNotBlank() && args.serviceId.isNotBlank()
                && args.deviceId.isNotBlank() && args.appVersion.isNotBlank())
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val input = workDataOf(
                GreekGodSyncWorker.DATABASE_PATH to args.databasePath,
                GreekGodSyncWorker.SERVICE_ID to args.serviceId,
                GreekGodSyncWorker.DEVICE_ID to args.deviceId,
                GreekGodSyncWorker.APP_VERSION to args.appVersion,
            )
            val periodic = PeriodicWorkRequestBuilder<GreekGodSyncWorker>(15, TimeUnit.MINUTES)
                .setInputData(input)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            val immediate = OneTimeWorkRequestBuilder<GreekGodSyncWorker>()
                .setInputData(input)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            val workManager = WorkManager.getInstance(activity.applicationContext)
            workManager.enqueueUniquePeriodicWork(
                "greekgod-sync:${args.serviceId}",
                ExistingPeriodicWorkPolicy.UPDATE,
                periodic,
            )
            workManager.enqueueUniqueWork(
                "greekgod-sync:${args.serviceId}:available",
                ExistingWorkPolicy.KEEP,
                immediate,
            )
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("GreekGod automatic sync could not be scheduled", error)
        }
    }

    @Command
    fun startRestTimer(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RestTimerPayload::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val alarms = activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                if (!alarms.canScheduleExactAlarms()) {
                    activity.startActivity(Intent(
                        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:${activity.packageName}"),
                    ))
                    throw IllegalStateException("Zezwól GreekGod na dokładne alarmy i uruchom timer ponownie")
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    39_175,
                )
                throw IllegalStateException("Zezwól GreekGod wyświetlać timer i uruchom go ponownie")
            }
            val status = GreekGodTimerManager.start(
                activity.applicationContext,
                GreekGodTimerManager.Config(
                    databasePath = args.databasePath,
                    deviceId = args.deviceId,
                    workoutId = args.workoutId,
                    exerciseId = args.exerciseId,
                    setId = args.setId,
                    templateLabel = args.templateLabel,
                    exerciseLabel = args.exerciseLabel,
                    previousLabel = args.previousLabel,
                    durationSeconds = args.durationSeconds,
                ),
            )
            invoke.resolve(timerStatusJson(status))
        } catch (error: Exception) {
            invoke.reject("GreekGod rest timer could not start", error)
        }
    }

    @Command
    fun restTimerStatus(invoke: Invoke) {
        try {
            invoke.resolve(timerStatusJson(GreekGodTimerManager.status(activity.applicationContext)))
        } catch (error: Exception) {
            invoke.reject("GreekGod rest timer state is unavailable", error)
        }
    }

    private fun timerStatusJson(status: GreekGodTimerManager.Status) = JSObject().apply {
        put("state", status.state)
        put("targetEpochMs", status.targetEpochMs)
        put("durationSeconds", status.durationSeconds)
    }

}
