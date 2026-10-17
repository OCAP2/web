package storage

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParsePlayerSnapshotEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(42),
		"inventorySnapshot",
		map[string]interface{}{"unitId": float64(7), "massUnits": 695.0},
	})

	require.NotNil(t, event)
	require.Equal(t, "inventorySnapshot", event.Type)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(7), payload["unitId"])
	require.Equal(t, 695.0, payload["massUnits"])
}

// Follow-up snapshots are recorded as diffs against an earlier frame. The server
// only carries them, so the nested "set" object and the "unset" paths must survive
// the round trip through the generic message field untouched.
func TestParsePlayerSnapshotEventPreservesDiff(t *testing.T) {
	for _, eventType := range []string{
		"inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot",
	} {
		event := parseEventArray([]interface{}{
			float64(120),
			eventType,
			map[string]interface{}{
				"unitId": float64(7),
				"diffOf": float64(60),
				"set": map[string]interface{}{
					"ace": map[string]interface{}{"heartRate": float64(133)},
				},
				"unset": []interface{}{"kat.spo2"},
			},
		})

		require.NotNil(t, event, eventType)
		require.Equal(t, eventType, event.Type)
		require.Equal(t, uint32(120), event.FrameNum)

		var payload map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
		require.Equal(t, float64(60), payload["diffOf"])
		require.Equal(t, []interface{}{"kat.spo2"}, payload["unset"])

		set := payload["set"].(map[string]interface{})
		ace := set["ace"].(map[string]interface{})
		require.Equal(t, float64(133), ace["heartRate"])
	}
}

func TestParsePlayerSnapshotEventPreservesMedicalLogs(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(80),
		"medicalSnapshot",
		map[string]interface{}{
			"unitId": float64(7),
			"activity": []interface{}{
				map[string]interface{}{"time": "10:02", "text": "Matthew Allen has bandaged patient"},
			},
			"quickView": []interface{}{
				map[string]interface{}{"time": "10:02", "text": "Matthew Allen checked Heart Rate: None"},
			},
		},
	})

	require.NotNil(t, event)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	activity := payload["activity"].([]interface{})
	entry := activity[0].(map[string]interface{})
	require.Equal(t, "10:02", entry["time"])
	require.Equal(t, "Matthew Allen has bandaged patient", entry["text"])
}

func TestParseTfarSettingsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(1),
		"tfarSettings",
		map[string]interface{}{
			"terrainInterceptionCoefficient": 12.0,
			"globalRadioRangeCoef":           0.5,
			"tfarLoaded":                     true,
			"source":                         "cba",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "tfarSettings", event.Type)
	require.Equal(t, uint32(1), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 12.0, payload["terrainInterceptionCoefficient"])
	require.Equal(t, 0.5, payload["globalRadioRangeCoef"])
	require.Equal(t, true, payload["tfarLoaded"])
	require.Equal(t, "cba", payload["source"])
}

func TestParseAcreSettingsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(1),
		"acreSettings",
		map[string]interface{}{
			"terrainLoss":            0.4,
			"signalModel":            1.0,
			"ignoreAntennaDirection": true,
			"acreLoaded":             true,
			"source":                 "cba",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "acreSettings", event.Type)
	require.Equal(t, uint32(1), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 0.4, payload["terrainLoss"])
	require.Equal(t, 1.0, payload["signalModel"])
	require.Equal(t, true, payload["ignoreAntennaDirection"])
	require.Equal(t, true, payload["acreLoaded"])
	require.Equal(t, "cba", payload["source"])
}

func TestParseServerFpsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(60),
		"serverFps",
		map[string]interface{}{"fps": 47.25},
	})

	require.NotNil(t, event)
	require.Equal(t, "serverFps", event.Type)
	require.Equal(t, uint32(60), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 47.25, payload["fps"])
}

func TestParseWeatherEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(60),
		"weather",
		map[string]interface{}{
			"overcast":   0.42,
			"rain":       0.1,
			"fog":        0.2,
			"windSpeed":  3.4,
			"windDir":    247.0,
			"humidity":   0.68,
			"moonPhase":  0.81,
			"temperature": 16.3,
			"ace":        true,
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "weather", event.Type)
	require.Equal(t, uint32(60), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 0.42, payload["overcast"])
	require.Equal(t, 16.3, payload["temperature"])
	require.Equal(t, true, payload["ace"])
}

func TestParseZeusPingEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(120),
		"zeusPing",
		map[string]interface{}{
			"curatorId": float64(42),
			"unitId":    float64(17),
			"name":      "Danny",
			"side":      "WEST",
			"x":         float64(3411),
			"y":         float64(9002),
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "zeusPing", event.Type)
	require.Equal(t, uint32(120), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(42), payload["curatorId"])
	require.Equal(t, float64(17), payload["unitId"])
	require.Equal(t, "Danny", payload["name"])
	require.Equal(t, "WEST", payload["side"])
	require.Equal(t, float64(3411), payload["x"])
	require.Equal(t, float64(9002), payload["y"])
}

// A ping is low-volume and must be readable without selecting a unit, so unlike
// the four per-player snapshot types it stays in the manifest.
func TestZeusPingIsNotAPlayerSnapshotEvent(t *testing.T) {
	require.False(t, IsPlayerSnapshotEvent("zeusPing"))
}

func TestParseZeusModuleEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(80),
		"zeusModule",
		map[string]interface{}{
			"curatorId":    float64(90),
			"curatorName":  "Danny",
			"className":    "zen_modules_moduleHeal",
			"displayName":  "Heal",
			"category":     "ACE",
			"source":       "zen",
			"x":            float64(3411),
			"y":            float64(9002),
			"attachedUnitId": float64(7),
			"attachedName": "Allen",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "zeusModule", event.Type)
	require.Equal(t, uint32(80), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(90), payload["curatorId"])
	require.Equal(t, "Heal", payload["displayName"])
	require.Equal(t, "zen_modules_moduleHeal", payload["className"])
	require.Equal(t, "Danny", payload["curatorName"])
	require.Equal(t, float64(3411), payload["x"])
	require.Equal(t, float64(9002), payload["y"])
}

func TestZeusModuleIsNotAPlayerSnapshotEvent(t *testing.T) {
	require.False(t, IsPlayerSnapshotEvent("zeusModule"))
}

func TestParseExplosionEventPreservesPayload(t *testing.T) {
	payload := map[string]interface{}{
		"x":         float64(3411),
		"y":         float64(9002),
		"ammo":      "Sh_155mm_AMOS",
		"name":      "155mm HE",
		"radius":    float64(28),
		"power":     float64(180),
		"firerId":   float64(17),
		"vehicleId": float64(4),
		"side":      "WEST",
		"source":    "projectile",
	}
	event := parseEventArray([]interface{}{
		float64(310),
		"explosion",
		payload,
	})

	require.NotNil(t, event)
	require.Equal(t, "explosion", event.Type)
	require.Equal(t, uint32(310), event.FrameNum)

	var decoded map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &decoded))
	require.Equal(t, payload, decoded)
	require.Zero(t, event.SourceID)
	require.Zero(t, event.TargetID)
	require.Zero(t, event.Distance)
}

func TestParseServiceEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(75),
		"serviceEvent",
		map[string]interface{}{
			"kind":        "refuel",
			"vehicleId":   float64(9),
			"vehicleName": "Hunter",
			"unitId":      float64(3),
			"unitName":    "Danny",
			"side":        "WEST",
			"x":           float64(1200),
			"y":           float64(3400),
			"from":        0.12,
			"to":          0.98,
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "serviceEvent", event.Type)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, "refuel", payload["kind"])
	require.Equal(t, float64(9), payload["vehicleId"])
	require.Equal(t, 0.12, payload["from"])
	require.Equal(t, 0.98, payload["to"])
}

func TestParseStaticWeaponEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(512),
		"staticWeapon",
		map[string]interface{}{
			"action":    "assembled",
			"unitId":    float64(3),
			"unitName":  "Danny",
			"side":      "WEST",
			"vehicleId": float64(88),
			"class":     "B_HMG_01_high_F",
			"name":      "M2 (High)",
			"x":         float64(1200),
			"y":         float64(3400),
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "staticWeapon", event.Type)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, "assembled", payload["action"])
	require.Equal(t, float64(88), payload["vehicleId"])
	require.Equal(t, "M2 (High)", payload["name"])
}

// These three are low-volume, global, and readable without selecting a unit, so
// like the Zeus events they stay in the manifest rather than moving into a
// per-player snapshot sidecar.
func TestSupportEventsAreNotPlayerSnapshotEvents(t *testing.T) {
	require.False(t, IsPlayerSnapshotEvent("explosion"))
	require.False(t, IsPlayerSnapshotEvent("serviceEvent"))
	require.False(t, IsPlayerSnapshotEvent("staticWeapon"))
}

func TestParseRadioTransmissionPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(30),
		"radioTransmission",
		map[string]interface{}{
			"unitId":     float64(7),
			"radio":      "AN/PRC-152",
			"type":       "SW",
			"action":     "Start",
			"channel":    float64(3),
			"additional": false,
			"frequency":  69.9,
			"code":       "0451",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "radioTransmission", event.Type)
	require.Equal(t, uint32(30), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(7), payload["unitId"])
	require.Equal(t, "SW", payload["type"])
	require.Equal(t, "Start", payload["action"])
	require.Equal(t, 69.9, payload["frequency"])
	require.Equal(t, "0451", payload["code"])
}

// Transmissions are global and low-volume, so they stay in the manifest rather
// than moving into a per-player snapshot sidecar.
func TestRadioTransmissionIsNotAPlayerSnapshotEvent(t *testing.T) {
	require.False(t, IsPlayerSnapshotEvent("radioTransmission"))
}

// The recorder writes a blast radius to one decimal rather than rounding to a
// whole metre. Recordings written before that change carry plain integers, so
// the manifest parser has to hand both back untouched -- it stores the payload
// as raw JSON precisely so a numeric shape change on the recorder side is not a
// format break.
func TestParseExplosionRadiusPrecisionIsPreserved(t *testing.T) {
	for name, radius := range map[string]float64{
		"legacy integer": 28,
		"one decimal":    5.4,
		"sub metre":      0.4,
	} {
		t.Run(name, func(t *testing.T) {
			event := parseEventArray([]interface{}{
				float64(10),
				"explosion",
				map[string]interface{}{
					"x":      float64(1),
					"y":      float64(2),
					"ammo":   "Sh_155mm_AMOS",
					"radius": radius,
				},
			})

			require.NotNil(t, event)
			require.Equal(t, "explosion", event.Type)

			var payload map[string]interface{}
			require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
			require.Equal(t, radius, payload["radius"])
		})
	}
}
