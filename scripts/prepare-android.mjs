import { mkdir, readFile, writeFile } from 'node:fs/promises';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const iconPath = 'android/app/src/main/res/drawable/ic_stat_kira.xml';

let manifest = await readFile(manifestPath, 'utf8');

const staleService = /\s*<service\s+android:name="(?:co\.capawesome\.capacitor\.android\.foregroundservice\.ForegroundService|io\.capawesome\.capacitorjs\.plugins\.foregroundservice\.ForegroundService)"[\s\S]*?\/>/;
const service = `
        <receiver
            android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver"
            android:enabled="true"
            android:exported="false" />

        <service
            android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="dataSync"
            android:stopWithTask="false" />`;

if (staleService.test(manifest)) {
  manifest = manifest.replace(staleService, service);
} else if (!manifest.includes('io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService')) {
  manifest = manifest.replace(/\n\s*<provider\b/, `${service}\n\n        <provider`);
}

const permissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.WAKE_LOCK',
];
for (const permission of permissions) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${permission}" />\n</manifest>`);
  }
}

await writeFile(manifestPath, manifest);
await mkdir('android/app/src/main/res/drawable', { recursive: true });
await writeFile(iconPath, `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M12,2A10,10 0,1 0,12 22A10,10 0,1 0,12 2M12,5L14,10L19,12L14,14L12,19L10,14L5,12L10,10Z" />
</vector>
`);

console.log('Android native preparation complete.');
