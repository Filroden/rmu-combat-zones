/**
 * RMU Combat Zones
 * A module to visualise combat facings and weapon reach.
 */

const MODULE_ID = "rmu-combat-zones";
const SETTING_TOGGLE = "showZones";

// --- Configuration Constants ---

// Fudge Factor: Minimum Body Zone in feet (2.5ft ensures padding for small tokens)
const MIN_BODY_ZONE = 2.5; 

// Metric Conversion Logic
const FT_PER_METER = 3.33333;
const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];

const ZONE_COLORS = {
    FRONT: 0x00FF00,
    FLANK: 0xFFFF00,
    REAR: 0xFF0000,
    SPOKE: 0x333333
};

const ZONES = [
    { start: 0, end: Math.PI, color: ZONE_COLORS.FRONT },
    { start: Math.PI, end: Math.PI + Math.PI / 3, color: ZONE_COLORS.FLANK },
    { start: -Math.PI / 3, end: 0, color: ZONE_COLORS.FLANK },
    { start: Math.PI + Math.PI / 3, end: Math.PI + 2 * Math.PI / 3, color: ZONE_COLORS.REAR }
];

// --- Initialisation ---

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING_TOGGLE, {
        name: "Show Combat Zones",
        scope: "client",
        config: false,
        type: Boolean,
        default: true,
        onChange: () => {
            canvas.tokens.placeables.forEach(t => {
                t._rmuDirty = true; // Force redraw
                RMUZoneRenderer.update(t);
            });
        }
    });
});

// --- Scene Controls ---

Hooks.on("getSceneControlButtons", (controls) => {
    const tokenLayer = controls.tokens;
    if (!tokenLayer) return;

    const rmuTool = {
        name: "rmu-zones",
        title: game.i18n.localize("RMU-ZONES.ToggleTitle"),
        icon: "fas fa-circle-dot",
        toggle: true,
        active: game.settings.get(MODULE_ID, SETTING_TOGGLE),
        onChange: () => {
            const current = game.settings.get(MODULE_ID, SETTING_TOGGLE);
            game.settings.set(MODULE_ID, SETTING_TOGGLE, !current);
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
        // 1. Safety Checks
        if (!canvas.scene || !token.actor || !token.visible) {
            this.clear(token);
            return;
        }

        const show = game.settings.get(MODULE_ID, SETTING_TOGGLE);
        if (!show) {
            this.clear(token);
            return;
        }

        // 2. Data Gathering (Body Zone)
        const rawBodyZone = Number(token.actor.system.appearance?._combatZone) || 0;
        // Apply minimum padding logic (Math.max to ensure at least 2.5ft)
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        // 3. Smart Redraw Check (Optimisation)
        const rotation = token.document.rotation;
        const width = token.w;  
        const height = token.h; 
        const weaponReaches = this.getWeaponReaches(token, bodyZoneFt);

        if (!token._rmuDirty && 
            token._rmuLastState?.rotation === rotation &&
            token._rmuLastState?.width === width &&
            token._rmuLastState?.height === height &&
            this.arraysEqual(token._rmuLastState?.reaches, weaponReaches)) {
            return;
        }

        // 4. Graphics Initialization
        let container = token.rmuZoneGraphics;
        if (!container) {
            container = new PIXI.Container();
            token.addChildAt(container, 0);
            token.rmuZoneGraphics = container;
        }
        
        container.removeChildren(); 

        // 5. Update Transform
        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        // 6. Draw
        
        // --- METRIC HANDLING START ---
        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const rawGridDist = canvas.scene.grid.distance;
        
        // If metric, convert the grid distance to feet (e.g. 1.5m -> 5ft)
        // If imperial, use as is (e.g. 5ft -> 5ft)
        const gridDistInFeet = isMetric ? (rawGridDist * FT_PER_METER) : rawGridDist;

        const gridData = {
            gridDist: gridDistInFeet, 
            gridSize: canvas.scene.grid.size
        };

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);
        const reachRadiiPx = weaponReaches.map(ft => this.ftToPx(ft, gridData));

        this.drawBodyZone(container, bodyRadiusPx);
        this.drawFrontArrow(container, bodyRadiusPx);

        if (reachRadiiPx.length > 0) {
            this.drawReachArcs(container, reachRadiiPx);
            
            const maxReach = Math.max(...reachRadiiPx);
            if (maxReach > bodyRadiusPx + 1) { 
                 this.drawSectorSpokes(container, bodyRadiusPx, maxReach);
            }
        }

        // 7. Save State
        token._rmuLastState = { rotation, width, height, reaches: weaponReaches };
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
        // Start with the Body Zone (Natural Reach)
        const reachRadii = new Set([bodyZoneFt]);
        const actor = token.actor;

        if (actor.items) {
            for (const item of actor.items) {
                const sys = item.system;
                if (sys.equipped !== "equipped") continue;
                if (item.type !== "weapon" && item.type !== "shield") continue;
                
                const isMelee = sys.usages?.some(u => 
                    ["Melee Weapons", "Shield"].includes(u.trainingGroup)
                );
                if (!isMelee) continue;

                const rawVal = sys._length || sys.length || "0";
                const valStr = String(rawVal).trim();
                let weaponLenFt = 0;

                const matchFt = valStr.match(/^(\d+)'(?:\s*(\d+)"?)?/);
                const matchIn = valStr.match(/^(\d+)"/);
                const matchNum = valStr.match(/^(\d+(?:\.\d+)?)/);

                if (matchFt) {
                    weaponLenFt = (parseFloat(matchFt[1]) || 0) + ((parseFloat(matchFt[2]) || 0) / 12);
                } else if (matchIn) {
                    weaponLenFt = (parseFloat(matchIn[1]) || 0) / 12;
                } else if (matchNum) {
                    weaponLenFt = parseFloat(matchNum[1]);
                }

                if (weaponLenFt > 0) {
                    // Logic: Add (Adjusted) Body Zone to Weapon Length
                    reachRadii.add(bodyZoneFt + weaponLenFt);
                }
            }
        }
        return Array.from(reachRadii).sort((a,b) => a-b);
    }

    static ftToPx(ft, gridData) {
        // ft / (Feet per Grid Square) * (Pixels per Grid Square)
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

    static drawBodyZone(g, radius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);

        ZONES.forEach(zone => {
            graphics.lineStyle(0); 
            graphics.beginFill(zone.color, 0.15); 
            graphics.moveTo(0, 0); 
            graphics.arc(0, 0, radius, zone.start, zone.end);
            graphics.lineTo(0, 0); 
            graphics.endFill();
        });
    }

    static drawFrontArrow(g, radius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        
        const angle = Math.PI / 2;
        const endDist = radius; 
        const endX = endDist * Math.cos(angle);
        const endY = endDist * Math.sin(angle);
        
        graphics.lineStyle(3, ZONE_COLORS.FRONT, 1.0);

        const headSize = radius * 0.15;
        const leftWing = angle - (Math.PI / 8); 
        const rightWing = angle + (Math.PI / 8);
        
        graphics.moveTo(endX, endY);
        graphics.lineTo(endX - (headSize * Math.cos(leftWing)), endY - (headSize * Math.sin(leftWing)));
        
        graphics.moveTo(endX, endY);
        graphics.lineTo(endX - (headSize * Math.cos(rightWing)), endY - (headSize * Math.sin(rightWing)));
    }

    static drawReachArcs(g, radii) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);

        radii.forEach(radius => {
            ZONES.forEach(zone => {
                graphics.lineStyle(3, zone.color, 0.8);
                const startX = radius * Math.cos(zone.start);
                const startY = radius * Math.sin(zone.start);
                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, radius, zone.start, zone.end);
            });
        });
    }

    static drawSectorSpokes(g, innerRadius, outerRadius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        graphics.lineStyle(2, ZONE_COLORS.SPOKE, 0.5);

        const boundaries = [0, Math.PI, -Math.PI/3, Math.PI + Math.PI/3];

        boundaries.forEach(angle => {
            graphics.moveTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
            graphics.lineTo(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle));
        });
    }
}

// --- Event Listeners ---

Hooks.on("refreshToken", (token) => {
    RMUZoneRenderer.update(token);
});

Hooks.on("updateActor", (actor) => {
    if (!actor) return;
    actor.getActiveTokens().forEach(t => {
        t._rmuDirty = true;
        RMUZoneRenderer.update(t);
    });
});

Hooks.on("updateItem", (item) => {
    if(item.parent) {
        item.parent.getActiveTokens().forEach(t => {
            t._rmuDirty = true;
            RMUZoneRenderer.update(t);
        });
    }
});

Hooks.on("destroyToken", (token) => {
    RMUZoneRenderer.clear(token);
});