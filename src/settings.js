/**
 * RMU Combat Zones - Settings Configuration
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
    METRIC_FACTOR: "metricFactor"
};

/**
 * Registers all module settings.
 * @param {Object} callbacks - Functions to run on change.
 * @param {Function} callbacks.redraw - Function to force a full canvas redraw.
 * @param {Function} callbacks.derive - Function to calculate data (for Toggle).
 */
export function registerSettings(callbacks) {
    const { redraw, derive } = callbacks;

    // 1. Main Toggle
    game.settings.register(MODULE_ID, SETTINGS.TOGGLE, {
        name: "RMU-ZONES.SettingToggleTitle",
        hint: "RMU-ZONES.SettingToggleHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            const active = game.settings.get(MODULE_ID, SETTINGS.TOGGLE);
            if (active) derive(); // Trigger derivation if turned ON
            redraw();
        }
    });

    // 2. Reach "Show All" Toggle
    game.settings.register(MODULE_ID, SETTINGS.REACH_SHOW_ALL, {
        name: "RMU-ZONES.SettingReachShowAllName",
        hint: "RMU-ZONES.SettingReachShowAllHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: redraw
    });

    // 3. Colours
    const colorSettings = [
        { key: SETTINGS.COLOR_FRONT, name: "RMU-ZONES.SettingColorFrontName", hint: "RMU-ZONES.SettingColorFrontHint", default: "#00FF00" },
        { key: SETTINGS.COLOR_FACING, name: "RMU-ZONES.SettingColorFacingName", hint: "RMU-ZONES.SettingColorFacingHint", default: "#00FF00" },
        { key: SETTINGS.COLOR_FLANK, name: "RMU-ZONES.SettingColorFlankName", hint: "RMU-ZONES.SettingColorFlankHint", default: "#FFFF00" },
        { key: SETTINGS.COLOR_REAR, name: "RMU-ZONES.SettingColorRearName", hint: "RMU-ZONES.SettingColorRearHint", default: "#FF0000" },
        { key: SETTINGS.COLOR_SPOKE, name: "RMU-ZONES.SettingColorSpokeName", hint: "RMU-ZONES.SettingColorSpokeHint", default: "#333333" }
    ];

    colorSettings.forEach(setting => {
        game.settings.register(MODULE_ID, setting.key, {
            name: setting.name,
            hint: setting.hint,
            scope: "client",
            config: true,
            type: String,
            default: setting.default,
            onChange: redraw
        });
    });

    // 4. Alpha
    game.settings.register(MODULE_ID, SETTINGS.ALPHA, {
        name: "RMU-ZONES.SettingAlphaName",
        hint: "RMU-ZONES.SettingAlphaHint",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0.15,
        onChange: redraw
    });

    // 5. Metric Factor
    game.settings.register(MODULE_ID, SETTINGS.METRIC_FACTOR, {
        name: "RMU-ZONES.SettingMetricFactorName",
        hint: "RMU-ZONES.SettingMetricFactorHint",
        scope: "client",
        config: true,
        type: Number,
        default: 3.33333,
        onChange: redraw
    });
}

// --- UI Magic: Add Color Pickers ---
Hooks.on("renderSettingsConfig", (app, html, data) => {
    const $html = $(html); 
    const colorKeys = [
        SETTINGS.COLOR_FRONT, 
        SETTINGS.COLOR_FACING,
        SETTINGS.COLOR_FLANK, 
        SETTINGS.COLOR_REAR, 
        SETTINGS.COLOR_SPOKE
    ];

    colorKeys.forEach(key => {
        const name = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${name}"]`);
        
        if (input.length) {
            const picker = $(`<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0;">`);
            picker.val(input.val());
            picker.on("change", (e) => input.val(e.target.value));
            input.on("change", (e) => picker.val(e.target.value));
            input.after(picker);
        }
    });
});