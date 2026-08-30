# Kira Heat Intelligence

Kira is an Android heat-safety companion that turns live location and heat data into a simple, actionable answer: **is it safe to go outside right now?**

[**Download the latest APK**](https://github.com/SHADOWGAMING97/SHADOWGAMING97/raw/refs/heads/main/Kira-Heat-Intelligence.apk)

## Features

Kira combines live heat intelligence, on-device storage, accessibility features, and background monitoring in one Android app.

| Feature | What it does |
|---|---|
| **Live FortyGuard API integration** | Connects to the FortyGuard heat API through native Android HTTP, submits a heatmap request, waits for the result, and displays the returned temperature and risk level. |
| **GPS location detection** | Requests location permission when the app opens, reads a fresh high-accuracy GPS position, and uses that position for the heat check. |
| **Manual location recovery** | Includes **CHECK**, **APP SETTINGS**, and **GPS SETTINGS** controls so permission and device Location services can be enabled manually if Android does not show the prompt. |
| **Heat-risk classification** | Converts the live reading into **Low, Moderate, High, or Extreme** risk. |
| **Reactive visual scene** | The character and background respond to risk: calm, sweating, seeking shade, or heading inside. |
| **Actionable safety guidance** | Shows short, easy-to-understand advice based on the current risk level. |
| **Scheduled intelligence checks** | Lets the user choose a frequency tier or enter a custom interval for automatic checks. |
| **Persistent countdown** | Shows the time until the next scheduled check and restores that schedule after the app is reopened. |
| **Timer recovery after failures** | If a scheduled API call fails or location is temporarily unavailable, the next check is still scheduled instead of leaving the timer stuck at `00:00`. |
| **Foreground monitoring notification** | Uses an Android foreground service with an ongoing notification showing the latest monitoring status. The notification updates instead of creating a new notification for every check. |
| **Notification permission support** | Requests Android notification permission where required and creates a dedicated Kira notification channel. |
| **Text-to-speech alerts** | Speaks critical heat warnings for High and Extreme risk conditions. |
| **Token economy** | Charges tokens according to the selected request tier and gives cached results a zero-token cost. |
| **Persistent token balance** | Saves token balance, request history, savings, cache-hit rate, and loyalty progress on the device so values do not reset after closing the app. |
| **Caching** | Stores recent heat readings locally and reuses them when appropriate to reduce unnecessary API calls and token usage. |
| **Tiered request strategy** | Supports Instant, Fast, Standard, and Batched modes with different request costs and cooldown behavior. |
| **Real savings statistics** | Shows saved tokens, cache-hit percentage, batched usage, request count, and loyalty status. |
| **API-key settings** | Allows the FortyGuard key to be entered from the hidden Advanced settings area and stored locally on the device. |
| **Explicit mock-mode switch** | Keeps testing mode separate from live mode so the user can see whether a reading is mock or live. |
| **Template-based chat** | Provides quick answers to questions such as “How hot is it?” and “Is it safe to go outside?” using the current reading. |
| **Three-tab interface** | Home shows the current reading, Frequency shows tokens and scheduling, and Profile contains settings and configuration. |
| **Offline-safe behavior** | Keeps the last valid reading and saved location available when a fresh GPS or network reading is temporarily unavailable. |
| **Persistent app settings** | Stores schedule, API configuration, alert preference, token state, cache, location history, and last-known location using Android Preferences. |
| **Android APK packaging** | Ships as an installable Capacitor Android APK with native Android permissions, foreground service support, and Gradle build files. |

## How it works

When Kira opens, it asks for location permission and reads the phone’s current GPS position. It sends that position to FortyGuard, receives the heat result, and presents the temperature, risk level, visual scene, safety advice, and optional spoken alert.

Kira saves its settings and recent data on the phone. The selected schedule counts down to the next check, performs the API request when due, updates the notification, records token usage, and schedules the following check—even when the previous attempt failed.

## Quick start

1. Install `Kira-Heat-Intelligence.apk` on an Android phone.
2. Allow Location permission when Android asks. If it does not appear, open **Profile → Location → APP SETTINGS**, enable permission, turn on **GPS SETTINGS**, and tap **CHECK**.
3. Open **Profile → Advanced**, enter a valid FortyGuard API key, and save it.
4. Select a checking tier or enter a custom schedule interval.
5. Return to Home to view the live heat reading and risk guidance.

The APK is built from the uploaded Kira source project. The Android source is included in this repository under `android/`, and the web/service source is under `src/www/`.

## Project structure

```text
src/www/                 App interface and on-device services
src/www/services/        API, GPS, cache, token, scheduler, TTS, and notification logic
android/                 Capacitor Android project and native permission plugin
scripts/                 Android preparation and verification scripts
Kira-Heat-Intelligence.apk  Installable debug APK
```

## Team

| Contribution | Person or tool |
|---|---|
| **Main builder / owner** | **Omkar** |
| **Backend and frontend building** | **Claude** |
| **Idea making** | **Omkar, Claude, and ChatGPT** |
| **APK building** | **Manus AI** |
| **Demo video** | **Gemini** |

## Credits

Kira was developed as a practical heat-safety concept combining mobile sensing, live heat intelligence, persistent local state, accessibility support, and human-centered safety guidance.

## License

This project is provided for demonstration and development purposes.
