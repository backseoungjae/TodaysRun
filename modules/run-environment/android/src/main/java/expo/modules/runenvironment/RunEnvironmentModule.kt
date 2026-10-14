package expo.modules.runenvironment

import android.content.Context
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class RunEnvironmentModule : Module() {
  companion object {
    // JS 런타임이 바뀌어도 같은 Android 프로세스에서는 유지된다.
    private val processToken = UUID.randomUUID().toString()
  }
  private fun preferences() = (appContext.reactContext ?: error("React context unavailable"))
    .getSharedPreferences("todaysrun.runtime", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("RunEnvironment")
    Function("snapshot") {
      mapOf("processToken" to processToken,
        "elapsedRealtimeMs" to SystemClock.elapsedRealtime().toDouble(),
        "wallTimeMs" to System.currentTimeMillis().toDouble())
    }
    Function("getSession") { preferences().getString("session", null) }
    Function("setSession") { value: String? ->
      val editor = preferences().edit()
      if (value == null) editor.remove("session") else editor.putString("session", value)
      check(editor.commit()) { "Runtime ownership could not be persisted" }
    }
  }
}
