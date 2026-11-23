# Keep Android 16 Jetpack AppFunctions entry points, KSP-generated aggregated
# inventory/invoker implementations (loaded via reflection by PlatformAppFunctionService),
# and @AppFunctionSerializable DTOs intact under R8 minification.
-keep public class top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions {
    public <init>();
    public *;
}

-keep class androidx.appfunctions.internal.$AggregatedAppFunctionInventory_Impl {
    public <init>();
    public *;
}

-keep class androidx.appfunctions.service.internal.$AggregatedAppFunctionInvoker_Impl {
    public <init>();
    public *;
}

-keep class top.logge.loggerythm.appfunctions.** implements androidx.appfunctions.internal.AppFunctionInventory {
    public *;
}

-keep class top.logge.loggerythm.appfunctions.** implements androidx.appfunctions.service.internal.AppFunctionInvoker {
    public *;
}

-keep class top.logge.loggerythm.appfunctions.** implements androidx.appfunctions.internal.AppFunctionSerializableFactory {
    public *;
}

-keep @androidx.appfunctions.AppFunctionSerializable class top.logge.loggerythm.appfunctions.** {
    *;
}
