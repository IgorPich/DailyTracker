package com.igorpich.greekgod.mobileplatform

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object GreekGodSecretVault {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "greekgod.mobile.pairing.master.v1"
    private const val PREFERENCES = "greekgod.mobile.secure.v1"
    private const val GCM_TAG_BITS = 128

    fun store(context: Context, alias: String, plaintext: String) {
        require(alias.isNotBlank() && alias.length <= 128 && plaintext.isNotEmpty())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        check(preferences(context).edit().putString(preferenceKey(alias), encoded).commit())
    }

    fun load(context: Context, alias: String): String? {
        require(alias.isNotBlank() && alias.length <= 128)
        val encoded = preferences(context).getString(preferenceKey(alias), null) ?: return null
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            loadMasterKey(),
            GCMParameterSpec(GCM_TAG_BITS, combined.copyOfRange(0, 12))
        )
        return String(cipher.doFinal(combined.copyOfRange(12, combined.size)), StandardCharsets.UTF_8)
    }

    fun delete(context: Context, alias: String) {
        require(alias.isNotBlank() && alias.length <= 128)
        check(preferences(context).edit().remove(preferenceKey(alias)).commit())
    }

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun preferenceKey(alias: String): String =
        Base64.encodeToString(
            alias.toByteArray(StandardCharsets.UTF_8),
            Base64.NO_WRAP or Base64.URL_SAFE
        )

    private fun getOrCreateMasterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(MASTER_KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun loadMasterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return keyStore.getKey(MASTER_KEY_ALIAS, null) as? SecretKey
            ?: throw IllegalStateException("GreekGod pairing master key is missing")
    }
}
