package com.igorpich.greekgod.mobileplatform

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import java.util.UUID

internal object GreekGodTimerManager {
    const val ACTION_FINISH = "com.igorpich.greekgod.mobileplatform.FINISH_TIMER"
    const val ACTION_START = "com.igorpich.greekgod.mobileplatform.START_TIMER"
    const val ACTION_ADD_SET = "com.igorpich.greekgod.mobileplatform.ADD_SET"
    const val SET_INPUT = "greekgod_set_input"
    const val EVENT_ID = "greekgod_event_id"
    private const val PREFERENCES = "greekgod.mobile.timer.v1"
    private const val CHANNEL_ID = "greekgod_rest_timer"
    private const val NOTIFICATION_ID = 3_9173
    private const val ALARM_REQUEST = 3_9174

    data class Config(
        val databasePath: String,
        val deviceId: String,
        val workoutId: String,
        val exerciseId: String,
        val setId: String,
        val templateLabel: String,
        val exerciseLabel: String,
        val previousLabel: String,
        val durationSeconds: Long,
    )

    data class Status(
        val state: String,
        val targetEpochMs: Long?,
        val durationSeconds: Long?,
    )

    fun start(context: Context, config: Config): Status {
        require(config.durationSeconds in 1..3_600)
        val targetEpochMs = System.currentTimeMillis() + config.durationSeconds * 1_000
        prefs(context).edit()
            .putString("state", "running")
            .putLong("targetEpochMs", targetEpochMs)
            .putLong("durationSeconds", config.durationSeconds)
            .putString("databasePath", config.databasePath)
            .putString("deviceId", config.deviceId)
            .putString("workoutId", config.workoutId)
            .putString("exerciseId", config.exerciseId)
            .putString("setId", config.setId)
            .putString("templateLabel", config.templateLabel)
            .putString("exerciseLabel", config.exerciseLabel)
            .putString("previousLabel", config.previousLabel)
            .commit().also { check(it) }
        createChannel(context)
        postRunning(context, targetEpochMs)
        scheduleAlarm(context, targetEpochMs)
        return Status("running", targetEpochMs, config.durationSeconds)
    }

    fun startStored(context: Context): Status? {
        val stored = loadConfig(context) ?: return null
        return start(context, stored)
    }

    fun status(context: Context): Status {
        val preferences = prefs(context)
        val state = preferences.getString("state", "idle") ?: "idle"
        val target = preferences.getLong("targetEpochMs", 0).takeIf { it > 0 }
        val duration = preferences.getLong("durationSeconds", 0).takeIf { it > 0 }
        if (state == "running" && target != null && target <= System.currentTimeMillis()) {
            finish(context)
            return Status("finished", target, duration)
        }
        return Status(state, target, duration)
    }

    fun finish(context: Context) {
        prefs(context).edit().putString("state", "finished").commit().also { check(it) }
        createChannel(context)
        val config = loadConfig(context)
        val notification = baseNotification(context, config)
            .setContentText("Przerwa zakończona")
            .setOngoing(false)
            .setAutoCancel(false)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .build()
        notify(context, notification)
    }

    fun showSetResult(context: Context, message: String) {
        val status = status(context)
        val config = loadConfig(context)
        val builder = baseNotification(context, config).setSubText(message)
        if (status.state == "running" && status.targetEpochMs != null) {
            builder.setWhen(status.targetEpochMs)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setOngoing(true)
        } else {
            builder.setContentText(message).setOngoing(false)
        }
        notify(context, builder.build())
    }

    fun loadConfig(context: Context): Config? {
        val preferences = prefs(context)
        fun required(key: String) = preferences.getString(key, null)?.takeIf(String::isNotBlank)
        return Config(
            databasePath = required("databasePath") ?: return null,
            deviceId = required("deviceId") ?: return null,
            workoutId = required("workoutId") ?: return null,
            exerciseId = required("exerciseId") ?: return null,
            setId = required("setId") ?: return null,
            templateLabel = required("templateLabel") ?: return null,
            exerciseLabel = required("exerciseLabel") ?: return null,
            previousLabel = preferences.getString("previousLabel", "—") ?: "—",
            durationSeconds = preferences.getLong("durationSeconds", 0).takeIf { it > 0 } ?: return null,
        )
    }

    @Synchronized
    fun wasHandled(context: Context, eventId: String): Boolean =
        prefs(context).getString("lastHandledEventId", null) == eventId

    @Synchronized
    fun markHandled(context: Context, eventId: String) {
        prefs(context).edit().putString("lastHandledEventId", eventId).commit().also { check(it) }
    }

    fun advanceSet(context: Context, setId: String, setNumber: Int, setCount: Int) {
        val preferences = prefs(context)
        val currentLabel = preferences.getString("exerciseLabel", "Ćwiczenie") ?: "Ćwiczenie"
        val exerciseName = currentLabel.replace(Regex(" · seria \\d+/\\d+$"), "")
        preferences.edit()
            .putString("setId", setId)
            .putString("exerciseLabel", "$exerciseName · seria $setNumber/$setCount")
            .commit().also { check(it) }
    }

    private fun postRunning(context: Context, targetEpochMs: Long) {
        val notification = baseNotification(context, loadConfig(context))
            .setWhen(targetEpochMs)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        notify(context, notification)
    }

    private fun baseNotification(context: Context, config: Config?): NotificationCompat.Builder {
        val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val openPending = openIntent?.let {
            PendingIntent.getActivity(
                context, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val addSetEventId = UUID.randomUUID().toString()
        val addSetIntent = Intent(context, GreekGodActionReceiver::class.java)
            .setAction(ACTION_ADD_SET)
            .putExtra(EVENT_ID, addSetEventId)
        val addSetPending = PendingIntent.getBroadcast(
            context, addSetEventId.hashCode(), addSetIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val remoteInput = RemoteInput.Builder(SET_INPUT)
            .setLabel("Wpisz np. 34.5x8")
            .build()
        val startEventId = UUID.randomUUID().toString()
        val startIntent = Intent(context, GreekGodActionReceiver::class.java)
            .setAction(ACTION_START)
            .putExtra(EVENT_ID, startEventId)
        val startPending = PendingIntent.getBroadcast(
            context, startEventId.hashCode(), startIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle("GreekGod · ${config?.templateLabel ?: "trening"}")
            .setContentText(config?.exerciseLabel ?: "Przerwa")
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                "${config?.exerciseLabel ?: "Przerwa"}\nPoprzednio: ${config?.previousLabel ?: "—"}"
            ))
            .setContentIntent(openPending)
            .addAction(
                NotificationCompat.Action.Builder(
                    android.R.drawable.ic_input_add, "Dodaj serię", addSetPending
                ).addRemoteInput(remoteInput).build()
            )
            .addAction(android.R.drawable.ic_media_play, "Start 2:30", startPending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        if (openPending != null) {
            builder.addAction(android.R.drawable.ic_menu_view, "Otwórz trening", openPending)
        }
        return builder
    }

    private fun scheduleAlarm(context: Context, targetEpochMs: Long) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST,
            Intent(context, GreekGodActionReceiver::class.java).setAction(ACTION_FINISH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val triggerElapsed = SystemClock.elapsedRealtime() +
            (targetEpochMs - System.currentTimeMillis()).coerceAtLeast(0)
        check(Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms())
        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            triggerElapsed,
            pending,
        )
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Przerwy treningowe",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Timer i szybkie zapisywanie serii GreekGod"
                enableVibration(true)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun notify(context: Context, notification: android.app.Notification) {
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // The timer remains durable even if the user has not granted notifications yet.
        }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}
