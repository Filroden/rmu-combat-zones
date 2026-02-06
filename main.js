/**
 * RMU Combat Zones
 * A module to visualise combat facings and weapon reach.
 */

import { MODULE_ID, SETTINGS, registerSettings } from "./src/settings.js";

// --- Internal Constants ---

const MIN_BODY_ZONE = 2.5; 
const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];

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
    // Define the callbacks that Settings needs to execute
    const callbacks = {
        redraw: () => {
            canvas.tokens.placeables.forEach(t => {
                t._rmuDirty = true;
                RMUZoneRenderer.update(t);
            });
        },
        derive: () => {
            canvas.tokens.placeables.forEach(t => deriveDataSafe(t));
        }
    };

    // Register all settings using the imported function
    registerSettings(callbacks);
});

// --- Event Hooks ---

Hooks.on("canvasReady", () => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        canvas.tokens.placeables.forEach(t => deriveDataSafe(t));
    }
});

Hooks.on("controlToken", (token, controlled) => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        if (controlled) deriveDataSafe(token);
        RMUZoneRenderer.update(token); 
    }
});

Hooks.on("hoverToken", (token, hovered) => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        if (hovered) deriveDataSafe(token);
        RMUZoneRenderer.update(token); 
    }
});

Hooks.on("updateActor", (actor) => {
    if (!actor) return;
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        const tokens = actor.getActiveTokens();
        for (const t of tokens) deriveDataSafe(t, true);
    }
});

Hooks.on("updateItem", (item) => {
    if(item.parent) {
        if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
            const tokens = item.parent.getActiveTokens();
            for (const t of tokens) deriveDataSafe(t, true);
        }
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

        // --- SMART REACH LOGIC ---
        const showAllReach = game.settings.get(MODULE_ID, SETTINGS.REACH_SHOW_ALL);
        let showReach = false;

        if (showAllReach) {
            showReach = true;
        } else {
            if (token.hover || token.controlled) {
                showReach = true;
            } else if (!game.user.isGM && token.document.isOwner) {
                showReach = true;
            }
        }

        // Config
        const drawConfig = {
            front: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT).replace("#", ""), 16),
            flank: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK).replace("#", ""), 16),
            rear:  parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR).replace("#", ""), 16),
            spoke: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE).replace("#", ""), 16),
            facing: parseInt(game.settings.get(MODULE_ID, SETTINGS.COLOR_FACING).replace("#", ""), 16),
            alpha: game.settings.get(MODULE_ID, SETTINGS.ALPHA)
        };

        const rawBodyZone = Number(token.actor.system.appearance?._combatZone) || 0;
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        const rotation = token.document.rotation;
        const width = token.w;  
        const height = token.h; 
        const weaponReaches = this.getWeaponReaches(token, bodyZoneFt);
        
        const configHash = JSON.stringify(drawConfig) + `|${showReach}`;

        if (!token._rmuDirty && 
            token._rmuLastState?.rotation === rotation &&
            token._rmuLastState?.width === width &&
            token._rmuLastState?.height === height &&
            token._rmuLastState?.configHash === configHash &&
            this.arraysEqual(token._rmuLastState?.reaches, weaponReaches)) {
            return;
        }

        let container = token.rmuZoneGraphics;
        if (!container) {
            container = new PIXI.Container();
            token.addChildAt(container, 0);
            token.rmuZoneGraphics = container;
        }
        container.removeChildren(); 

        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const rawGridDist = canvas.scene.grid.distance;
        const gridDistInFeet = isMetric ? (rawGridDist * game.settings.get(MODULE_ID, SETTINGS.METRIC_FACTOR)) : rawGridDist;

        const gridData = {
            gridDist: gridDistInFeet, 
            gridSize: canvas.scene.grid.size
        };

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);
        
        this.drawBodyZone(container, bodyRadiusPx, drawConfig);
        this.drawFrontArrow(container, bodyRadiusPx, drawConfig);

        if (showReach && weaponReaches.length > 0) {
            const reachRadiiPx = weaponReaches.map(ft => this.ftToPx(ft, gridData));
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
        
        // Define Triangle Geometry
        const angle = Math.PI / 2; // Facing "Down" in PIXI coordinates (which aligns with Token Front)
        
        // Offset: 5px gap outside the body zone
        const offset = 5; 
        const startY = radius + offset;

        const height = radius * 0.20; 
        const width = height * 1.5;   
        
        // Calculate Vertices (relative to rotated container)
        const tipY = startY + height;
        const tipX = 0;

        const baseLeftX = -width / 2;
        const baseLeftY = startY;
        const baseRightX = width / 2;
        const baseRightY = startY;

        // Draw
        graphics.lineStyle(4, config.facing, 1.0); // Thicker line, separate colour
        graphics.beginFill(config.facing, 0.25);   // Low opacity fill
        
        graphics.moveTo(baseLeftX, baseLeftY);
        graphics.lineTo(tipX, tipY);
        graphics.lineTo(baseRightX, baseRightY);
        graphics.closePath(); 
        
        graphics.endFill();
    }

    static drawReachArcs(g, radii, config) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        const zones = this.getZones(config);

        // We want the ring to be drawn "inside" the reach limit.
        // Since the line width is 3px, we shift the radius inward by 1.5px (half width).
        const width = 3;
        const offset = width / 2;

        radii.forEach(radius => {
            // Shift radius inward
            const drawRadius = radius - offset;

            zones.forEach(zone => {
                graphics.lineStyle(width, zone.color, 0.8);
                
                // Calculate start point based on the NEW drawRadius
                const startX = drawRadius * Math.cos(zone.start);
                const startY = drawRadius * Math.sin(zone.start);
                
                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, drawRadius, zone.start, zone.end);
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