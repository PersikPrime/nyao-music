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

android {
    namespace = "org.nyao.music"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.nyao.music"
        minSdk = 26
        targetSdk = 36
        versionCode = nyaoBuild
        versionName = "$nyaoName ($nyaoBuild)"
    }

    buildTypes {
        release {
            // Личная сборка: подписываем debug-ключом, чтобы APK сразу ставился
            signingConfig = signingConfigs.getByName("debug")
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
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.media3:media3-database:$media3")
    implementation("com.google.guava:guava:33.4.0-android")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
}
