plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
}

// Supply-chain: lock all dependency configurations so transitive versions
// are reproducible. Generate / update lock files with:
//   ./gradlew dependencies --write-locks
// Commit the resulting gradle/dependency-locks/*.lockfile files.
allprojects {
    dependencyLocking {
        lockAllConfigurations()
    }
}
