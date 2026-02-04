/**
 * RMU Combat Zones
 * A module to visualise combat facings and weapon reach.
 */

const MODULE_ID = "rmu-combat-zones";

// --- Internal Constants ---

// Fudge Factor: Minimum Body Zone in feet
// Hardcoded to 2.5ft to match RMU System logic for small token reach.
const MIN_BODY_ZONE = 2.5; 

const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];

// Setting Keys
const SETTINGS = {
    TOGGLE: "showZones",
    COLOR_FRONT: "colorFront",
    COLOR_FLANK: "colorFlank",
    COLOR_REAR: "colorRear",
    COLOR_SPOKE: "colorSpoke",
    ALPHA: "zoneAlpha",
    METRIC_FACTOR: "metricFactor"
};

// --- Helper: Safe Derivation ---
async function deriveDataSafe(token, force = false) {
    if (force) token._rmuDerived = false;
    if (typeof token.document.hudDeriveExtendedData !== "function") return;
    if (token._rmuDeriving) return;
    if (token._rmuDerived && !force) return;

    token._rmuDeriving = true;
    try {
        await token.document.hudDeriveExtendedData();
        token._rmuDerived = true; 
        token._rmuDirty = true;
        RMUZoneRenderer.update(token);
    } catch (err) {
        console.warn("RMU Zones | Derivation failed:", err);
    } finally {
        token._rmuDeriving = false;
    }
}

// --- Initialisation ---

Hooks.once("init", () => {
    
    // Helper to redraw all tokens when a setting changes
    const redrawAll = () => {
        canvas.tokens.placeables.forEach(t => {
            t._rmuDirty = true;
            RMUZoneRenderer.update(t);
        });
    };

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
            if (active) canvas.tokens.placeables.forEach(t => deriveDataSafe(t));
            redrawAll();
        }
    });

    // 2. Colors (Stored as Strings, UI upgraded via Hook)
    game.settings.register(MODULE_ID, SETTINGS.COLOR_FRONT, {
        name: "RMU-ZONES.SettingColorFrontName",
        hint: "RMU-ZONES.SettingColorFrontHint",
        scope: "client",
        config: true,
        type: String, 
        default: "#00FF00",
        onChange: redrawAll
    });
    
    game.settings.register(MODULE_ID, SETTINGS.COLOR_FLANK, {
        name: "RMU-ZONES.SettingColorFlankName",
        hint: "RMU-ZONES.SettingColorFlankHint",
        scope: "client",
        config: true,
        type: String,
        default: "#FFFF00",
        onChange: redrawAll
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR_REAR, {
        name: "RMU-ZONES.SettingColorRearName",
        hint: "RMU-ZONES.SettingColorRearHint",
        scope: "client",
        config: true,
        type: String,
        default: "#FF0000",
        onChange: redrawAll
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR_SPOKE, {
        name: "RMU-ZONES.SettingColorSpokeName",
        hint: "RMU-ZONES.SettingColorSpokeHint",
        scope: "client",
        config: true,
        type: String,
        default: "#333333",
        onChange: redrawAll
    });

    // 3. Alpha (Opacity)
    game.settings.register(MODULE_ID, SETTINGS.ALPHA, {
        name: "RMU-ZONES.SettingAlphaName",
        hint: "RMU-ZONES.SettingAlphaHint",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0.15,
        onChange: redrawAll
    });

    // 4. Metric Conversion Factor
    game.settings.register(MODULE_ID, SETTINGS.METRIC_FACTOR, {
        name: "RMU-ZONES.SettingMetricFactorName",
        hint: "RMU-ZONES.SettingMetricFactorHint",
        scope: "client",
        config: true,
        type: Number,
        default: 3.33333,
        onChange: redrawAll
    });
});

// --- Add Color Pickers to Settings Menu ---
Hooks.on("renderSettingsConfig", (app, html, data) => {
    const $html = $(html);
    
    const colorSettings = [
        SETTINGS.COLOR_FRONT,
        SETTINGS.COLOR_FLANK,
        SETTINGS.COLOR_REAR,
        SETTINGS.COLOR_SPOKE
    ];

    colorSettings.forEach(key => {
        const name = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${name}"]`);
        
        if (input.length) {
            // Create a color picker input
            const picker = $(`<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0;">`);
            picker.val(input.val());

            // Sync picker -> text input
            picker.on("change", (e) => {
                input.val(e.target.value);
            });

            // Sync text input -> picker
            input.on("change", (e) => {
                picker.val(e.target.value);
            });

            // Append next to the text box
            input.after(picker);
        }
    });
});

// --- Event Hooks ---

Hooks.on("canvasReady", () => {
    canvas.tokens.placeables.forEach(t => deriveDataSafe(t));
});

Hooks.on("controlToken", (token, controlled) => {
    if (controlled) deriveDataSafe(token);
});

Hooks.on("hoverToken", (token, hovered) => {
    if (hovered) deriveDataSafe(token);
});

Hooks.on("updateActor", (actor) => {
    if (!actor) return;
    const tokens = actor.getActiveTokens();
    for (const t of tokens) deriveDataSafe(t, true);
});

Hooks.on("updateItem", (item) => {
    if(item.parent) {
        const tokens = item.parent.getActiveTokens();
        for (const t of tokens) deriveDataSafe(t, true);
    }
});

Hooks.on("refreshToken", (token) => {
    RMUZoneRenderer.update(token);
});

Hooks.on("destroyToken", (token) => {
    RMUZoneRenderer.clear(token);
});

// --- Scene Controls ---

Hooks.on("getSceneControlButtons", (controls) => {
    const tokenLayer = controls.tokens;
    if (!tokenLayer) return;

    const rmuTool = {
        name: "rmu-zones",
        title: "RMU-ZONES.ToggleTitle",
        icon: "fas fa-circle-dot",
        toggle: true,
        active: game.settings.get(MODULE_ID, SETTINGS.TOGGLE),
        onChange: () => {
            const current = game.settings.get(MODULE_ID, SETTINGS.TOGGLE);
            game.settings.set(MODULE_ID, SETTINGS.TOGGLE, !current);
        }
    };

    if (Array.isArray(tokenLayer.tools)) {
        tokenLayer.tools.push(rmuTool);
    } else {
        tokenLayer.tools["rmu-zones"] = rmuTool;
    }
});

// --- The Renderer Logic ---

class RMUZoneRenderer {

    static update(token) {
        // Safety Checks
        if (!token.visible || !token.actor || !canvas.scene) {
            this.clear(token);
            return;
        }

        if (!game.settings.settings.has(`${MODULE_ID}.${SETTINGS.TOGGLE}`)) return;
        const show = game.settings.get(MODULE_ID, SETTINGS.TOGGLE);
        if (!show) {
            this.clear(token);
            return;
        }

        // --- READ SETTINGS ---
        const metricFactor = game.settings.get(MODULE_ID, SETTINGS.METRIC_FACTOR);
        
        // Prepare config for drawing (converting Hex strings to Integers)
        const drawConfig = {
            front: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT).replace("#", ""), 16),
            flank: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK).replace("#", ""), 16),
            rear:  parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR).replace("#", ""), 16),
            spoke: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE).replace("#", ""), 16),
            alpha: game.settings.get(MODULE_ID, SETTINGS.ALPHA)
        };

        // Data Gathering
        const rawBodyZone = Number(token.actor.system.appearance?._combatZone) || 0;
        
        // Use Internal Constant for Min Zone
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        // Optimisation Check
        const rotation = token.document.rotation;
        const width = token.w;  
        const height = token.h; 
        const weaponReaches = this.getWeaponReaches(token, bodyZoneFt);
        
        // Check if settings changed by comparing a simple hash of the config
        const configHash = JSON.stringify(drawConfig);

        if (!token._rmuDirty && 
            token._rmuLastState?.rotation === rotation &&
            token._rmuLastState?.width === width &&
            token._rmuLastState?.height === height &&
            token._rmuLastState?.configHash === configHash &&
            this.arraysEqual(token._rmuLastState?.reaches, weaponReaches)) {
            return;
        }

        // Graphics Initialization
        let container = token.rmuZoneGraphics;
        if (!container) {
            container = new PIXI.Container();
            token.addChildAt(container, 0);
            token.rmuZoneGraphics = container;
        }
        container.removeChildren(); 

        // Update Transform
        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        // Grid Logic
        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const rawGridDist = canvas.scene.grid.distance;
        const gridDistInFeet = isMetric ? (rawGridDist * metricFactor) : rawGridDist;

        const gridData = {
            gridDist: gridDistInFeet, 
            gridSize: canvas.scene.grid.size
        };

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);
        const reachRadiiPx = weaponReaches.map(ft => this.ftToPx(ft, gridData));

        this.drawBodyZone(container, bodyRadiusPx, drawConfig);
        this.drawFrontArrow(container, bodyRadiusPx, drawConfig);

        if (reachRadiiPx.length > 0) {
            this.drawReachArcs(container, reachRadiiPx, drawConfig);
            
            const maxReach = Math.max(...reachRadiiPx);
            if (maxReach > bodyRadiusPx + 1) { 
                 this.drawSectorSpokes(container, bodyRadiusPx, maxReach, drawConfig);
            }
        }

        token._rmuLastState = { rotation, width, height, reaches: weaponReaches, configHash };
        token._rmuDirty = false;
    }

    static clear(token) {
        if (token.rmuZoneGraphics) {
            token.rmuZoneGraphics.destroy({children: true});
            token.rmuZoneGraphics = null;
            token._rmuLastState = null;
        }
    }

    static getWeaponReaches(token, bodyZoneFt) {
        const reachRadii = new Set([bodyZoneFt]);
        const attacks = token.actor.system._attacks;

        if (!Array.isArray(attacks) || attacks.length === 0) {
            return Array.from(reachRadii);
        }

        for (const att of attacks) {
            if (att.isEquipped === false) continue;
            if (att.isRanged === true) continue;
            
            const range = att.meleeRange;
            if (typeof range === "number" && range > 0) {
                reachRadii.add(Math.max(range, bodyZoneFt));
            }
        }
        return Array.from(reachRadii).sort((a,b) => a-b);
    }

    static ftToPx(ft, gridData) {
        return (ft / gridData.gridDist) * gridData.gridSize;
    }

    static arraysEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    // --- Drawing Primitives ---

    static getZones(config) {
        return [
            { start: 0, end: Math.PI, color: config.front },
            { start: Math.PI, end: Math.PI + Math.PI / 3, color: config.flank },
            { start: -Math.PI / 3, end: 0, color: config.flank },
            { start: Math.PI + Math.PI / 3, end: Math.PI + 2 * Math.PI / 3, color: config.rear }
        ];
    }

    static drawBodyZone(g, radius, config) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        const zones = this.getZones(config);
        
        zones.forEach(zone => {
            graphics.lineStyle(0); 
            graphics.beginFill(zone.color, config.alpha); 
            graphics.moveTo(0, 0); 
            graphics.arc(0, 0, radius, zone.start, zone.end);
            graphics.lineTo(0, 0); 
            graphics.endFill();
        });
    }

    static drawFrontArrow(g, radius, config) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        const angle = Math.PI / 2;
        const endDist = radius; 
        const endX = endDist * Math.cos(angle);
        const endY = endDist * Math.sin(angle);
        
        graphics.lineStyle(3, config.front, 1.0);
        
        const headSize = radius * 0.15;
        const leftWing = angle - (Math.PI / 8); 
        const rightWing = angle + (Math.PI / 8);
        graphics.moveTo(endX, endY);
        graphics.lineTo(endX - (headSize * Math.cos(leftWing)), endY - (headSize * Math.sin(leftWing)));
        graphics.moveTo(endX, endY);
        graphics.lineTo(endX - (headSize * Math.cos(rightWing)), endY - (headSize * Math.sin(rightWing)));
    }

    static drawReachArcs(g, radii, config) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        const zones = this.getZones(config);

        radii.forEach(radius => {
            zones.forEach(zone => {
                graphics.lineStyle(3, zone.color, 0.8);
                const startX = radius * Math.cos(zone.start);
                const startY = radius * Math.sin(zone.start);
                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, radius, zone.start, zone.end);
            });
        });
    }

    static drawSectorSpokes(g, innerRadius, outerRadius, config) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        graphics.lineStyle(2, config.spoke, 0.5);
        
        const boundaries = [0, Math.PI, -Math.PI/3, Math.PI + Math.PI/3];
        boundaries.forEach(angle => {
            graphics.moveTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
            graphics.lineTo(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle));
        });
    }
}