# Umbra keeps no reflection-driven code, so the defaults are almost enough.

# WebView JavaScript interfaces would be stripped; Umbra exposes none, but
# keeping the annotation contract documented avoids a surprise if one is added.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Kotlin metadata is not needed at runtime.
-dontwarn kotlin.**
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
