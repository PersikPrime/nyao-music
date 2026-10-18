plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Версия «0.2 (14)» берётся из общего ../version.json — того же, что у десктопной версии
val versionFile = rootProject.file("../version.json")
val versionJson = if (versionFile.exists()) versionFile.readText() else "{}"
val nyaoName = Regex("\"name\"\\s*:\\s*\"([^\"]+)\"").find(versionJson)?.groupValues?.get(1) ?: "0.2"
val nyaoBuild = Regex("\"build\"\\s*:\\s*(\\d+)").find(versionJson)?.groupValues?.get(1)?.toInt() ?: 1
// "channel": "dev" — сборка из dev-ветки
val nyaoChannel = Regex("\"channel\"\\s*:\\s*\"([^\"]+)\"").find(versionJson)?.groupValues?.get(1)

android {
    namespace = "org.nyao.music"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.nyao.music"
        minSdk = 26
        targetSdk = 36
        versionCode = nyaoBuild
        versionName = "$nyaoName ($nyaoBuild)" + (nyaoChannel?.let { " $it" } ?: "")
        // ключи Last.fm — из секретов GitHub (без них Last.fm в настройках выключен)
        buildConfigField("String", "LASTFM_KEY", "\"" + (System.getenv("NYAO_LASTFM_KEY") ?: "") + "\"")
        buildConfigField("String", "LASTFM_SECRET", "\"" + (System.getenv("NYAO_LASTFM_SECRET") ?: "") + "\"")
    }

    // Постоянный ключ подписи: без него каждая сборка на GitHub подписывалась новым случайным debug-ключом,
    // и Android отказывался ставить обновление поверх («App not installed»). Ключ лежит в секретах GitHub,
    // CI кладёт его в файл и передаёт путь и пароли через переменные окружения.
    val ksPath = System.getenv("NYAO_KEYSTORE")
    signingConfigs {
        if (ksPath != null && file(ksPath).exists()) {
            create("nyao") {
                storeFile = file(ksPath)
                storePassword = System.getenv("NYAO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NYAO_KEY_ALIAS") ?: "nyao"
                keyPassword = System.getenv("NYAO_KEY_PASSWORD") ?: System.getenv("NYAO_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // Есть постоянный ключ — подписываем им; локально без ключа — debug-ключом, чтобы APK ставился
            signingConfig = signingConfigs.findByName("nyao") ?: signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.webkit:webkit:1.12.1")

    val media3 = "1.8.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-session:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.media3:media3-database:$media3")
    implementation("com.google.guava:guava:33.4.0-android")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // QR-код приглашения в друзья
    implementation("com.google.zxing:core:3.5.3")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
}
