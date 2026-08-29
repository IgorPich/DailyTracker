package com.igorpich.greekgod.mobileplatform

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import org.json.JSONObject

internal fun optionalJsonString(isJsonNull: Boolean, value: String): String? =
    value.takeIf { !isJsonNull && it.isNotBlank() }

class GreekGodActionReceiver : BroadcastReceiver() {
    companion object {
        init {
            System.loadLibrary("greekgod_mobile_lib")
        }

        @JvmStatic
        private external fun nativeRecordSet(
            databasePath: String,
            deviceId: String,
            workoutId: String,
            exerciseId: String,
            setId: String,
            weight: Double,
            reps: Int,
        ): String?

    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            GreekGodTimerManager.ACTION_FINISH -> GreekGodTimerManager.finish(context)
            GreekGodTimerManager.ACTION_START -> {
                val eventId = intent.getStringExtra(GreekGodTimerManager.EVENT_ID) ?: return
                if (GreekGodTimerManager.wasHandled(context, eventId)) return
                GreekGodTimerManager.markHandled(context, eventId)
                GreekGodTimerManager.startStored(context)
            }
            GreekGodTimerManager.ACTION_ADD_SET -> recordSet(context, intent)
        }
    }

    private fun recordSet(context: Context, intent: Intent) {
        val eventId = intent.getStringExtra(GreekGodTimerManager.EVENT_ID) ?: return
        if (GreekGodTimerManager.wasHandled(context, eventId)) return
        val raw = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(GreekGodTimerManager.SET_INPUT)?.toString().orEmpty()
        val parsed = GreekGodSetInputParser.parse(raw)
        if (parsed == null) {
            GreekGodTimerManager.showSetResult(context, "Nie zapisano · użyj formatu 34.5 x 8")
            return
        }
        val config = GreekGodTimerManager.loadConfig(context)
        if (config == null) {
            GreekGodTimerManager.showSetResult(context, "Nie zapisano · otwórz trening")
            return
        }
        val saved = runCatching {
            nativeRecordSet(
                config.databasePath,
                config.deviceId,
                config.workoutId,
                config.exerciseId,
                config.setId,
                parsed.weight,
                parsed.reps,
            )
        }.getOrNull()
        if (saved != null) {
            GreekGodTimerManager.markHandled(context, eventId)
            val result = runCatching { JSONObject(saved) }.getOrNull()
            val nextSetId = optionalJsonString(
                result == null || result.isNull("nextSetId"),
                result?.optString("nextSetId").orEmpty(),
            )
            if (nextSetId != null && result != null) {
                GreekGodTimerManager.advanceSet(
                    context,
                    nextSetId,
                    result.optInt("nextSetNumber"),
                    result.optInt("setCount"),
                )
            }
        }
        GreekGodTimerManager.showSetResult(
            context,
            if (saved != null) "Zapisano ${parsed.normalized}" else "Nie zapisano · dane lokalne bez zmian",
        )
    }
}
