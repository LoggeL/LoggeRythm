# WorkManager persists the Worker class name across process death and device reboot.
-keep class top.logge.loggerythm.player.LoggeRythmPlaybackJournalWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
