package com.lucky.lsa.heatintel;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int LOCATION_PERMISSION_REQUEST = 4101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationControlPlugin.class);
        super.onCreate(savedInstanceState);
        requestLocationPermissionIfNeeded();
    }

    private void requestLocationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, LOCATION_PERMISSION_REQUEST);
        }
    }
}
