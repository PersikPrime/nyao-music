// Nyao Legacy — тонкий клиент для Android 4.1–4.4. Без AndroidX и Kotlin: только платформа, чтобы APK был маленьким
// и работал на старых устройствах. Android 4.0 (API 14–15) не берём: там нет TLS 1.2, сервер с ним не заговорит.
plugins {
    id("com.android.application")
}

android {
    namespace = "org.nyao.legacy"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.nyao.legacy"
        minSdk = 16
        targetSdk = 23
        versionCode = 1
        versionName = "0.1"
        // устройства на 4.x — 32-битные ARM или Intel Atom; 64-битные библиотеки им не нужны
        ndk {
            abiFilters += listOf("armeabi-v7a", "x86")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    lint {
        // старые API используются намеренно
        abortOnError = false
    }
}

dependencies {
    // Свой TLS-движок (BoringSSL): TLS 1.2/1.3 с AES-GCM и ChaCha20 там, где системный OpenSSL 4.x их не умеет
    implementation("org.conscrypt:conscrypt-android:2.5.2")
}
