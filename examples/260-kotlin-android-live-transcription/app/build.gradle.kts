plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.deepgram.example.livetranscription"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.deepgram.example.livetranscription"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        val deepgramApiKey: String = project.findProperty("DEEPGRAM_API_KEY") as? String
            ?: System.getenv("DEEPGRAM_API_KEY")
            ?: ""
        buildConfigField("String", "DEEPGRAM_API_KEY", "\"$deepgramApiKey\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("com.deepgram:deepgram-java-sdk:0.2.0")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
}
