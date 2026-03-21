/**
 * src/settings.js
 * Configuration and UI settings.
 */

export const MODULE_ID = "rmu-combat-zones";

export const SETTINGS = {
    TOGGLE: "showZones",
    REACH_SHOW_ALL: "reachShowAll",
    COLOR_FRONT: "colorFront",
    COLOR_FLANK: "colorFlank",
    COLOR_REAR: "colorRear",
    COLOR_SPOKE: "colorSpoke",
    COLOR_FACING: "colorFacing",
    ALPHA: "zoneAlpha",
    METRIC_FACTOR: "metricFactor",
    SHOW_LABELS: "showLabels",
    SHOW_THREAT_RULER: "showThreatRuler",
};

/**
 * Registers all module settings.
 * @param {Object} callbacks - Functions to run on change.
 * @param {Function} callbacks.redraw - Function to force a full canvas redraw.
 * @param {Function} callbacks.derive - Function to calculate data (for Toggle).
 */
export function registerSettings(callbacks) {
    const { redraw, derive } = callbacks;

    // Small helper to capitalize the first letter so "showLabels" matches "ShowLabels" in JSON
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Helper for repetitive client settings
    const register = (key, type, def, config = true) => {
        game.settings.register(MODULE_ID, key, {
            name: `RMU-ZONES.Setting${capitalize(key)}Name`,
            hint: `RMU-ZONES.Setting${capitalize(key)}Hint`,
            scope: "client",
            config,
            type,
            default: def,
            onChange: redraw,
        });
    };

    // 1. Main Toggle
    game.settings.register(MODULE_ID, SETTINGS.TOGGLE, {
        name: `RMU-ZONES.SettingToggleTitle`,
        hint: `RMU-ZONES.SettingToggleHint`,
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: (val) => {
            if (val) derive();
            redraw();
        },
    });

    // 2. Standard Settings
    register(SETTINGS.REACH_SHOW_ALL, Boolean, false);
    register(SETTINGS.SHOW_LABELS, Boolean, false);
    register(SETTINGS.SHOW_THREAT_RULER, Boolean, false);
    register(SETTINGS.METRIC_FACTOR, Number, 3.33333);

    // Alpha Slider
    game.settings.register(MODULE_ID, SETTINGS.ALPHA, {
        name: `RMU-ZONES.SettingAlphaName`,
        hint: `RMU-ZONES.SettingAlphaHint`,
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0.15,
        onChange: redraw,
    });

    // 3. Colours (Using Native ColorField)
    const { ColorField } = foundry.data.fields;
    const colorSettings = [
        [SETTINGS.COLOR_FRONT, "#00FF00"],
        [SETTINGS.COLOR_FACING, "#00FF00"],
        [SETTINGS.COLOR_FLANK, "#FFFF00"],
        [SETTINGS.COLOR_REAR, "#FF0000"],
        [SETTINGS.COLOR_SPOKE, "#333333"],
    ];

    colorSettings.forEach(([key, def]) => {
        game.settings.register(MODULE_ID, key, {
            name: `RMU-ZONES.Setting${capitalize(key)}Name`,
            hint: `RMU-ZONES.Setting${capitalize(key)}Hint`,
            scope: "client",
            config: true,
            type: new ColorField({ required: true, initial: def }),
            onChange: redraw,
        });
    });
}
