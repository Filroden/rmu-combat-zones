/**
 * RMU Combat Zones
 * A module to visualise combat facings and weapon reach.
 */

const MODULE_ID = "rmu-combat-zones";
const SETTING_TOGGLE = "showZones";

// --- Initialisation ---

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING_TOGGLE, {
        name: "RMU-ZONES.SettingName",
        hint: "RMU-ZONES.SettingHint",
        scope: "client",
        config: false,
        type: Boolean,
        default: true,
        onChange: () => canvas.tokens.placeables.forEach(t => RMUZoneRenderer.update(t))
    });
});

// --- Scene Controls (The HUD Button) ---

Hooks.on("getSceneControlButtons", (controls) => {
    const tokenLayer = controls.tokens;

    if (tokenLayer) {
        const rmuTool = {
            name: "rmu-zones",
            title: "RMU-ZONES.ToggleTitle",
            icon: "fas fa-circle-dot",
            toggle: true,
            active: game.settings.get(MODULE_ID, SETTING_TOGGLE),
            onClick: (toggled) => {
                game.settings.set(MODULE_ID, SETTING_TOGGLE, toggled);
            }
        };

        if (Array.isArray(tokenLayer.tools)) {
            tokenLayer.tools.push(rmuTool);
        } else {
            tokenLayer.tools["rmu-zones"] = rmuTool;
        }
    }
});

// --- The Renderer Logic ---

class RMUZoneRenderer {

    static update(token) {
        // 1. Clean up existing graphics
        if (token.rmuZoneGraphics) {
            token.rmuZoneGraphics.destroy();
            token.rmuZoneGraphics = null;
        }

        // 2. Check Conditions
        const show = game.settings.get(MODULE_ID, SETTING_TOGGLE);
        // Safety: Must have actor and be visible
        if (!show || !token.actor || !token.visible) return;

        // 3. Gather Data
        const data = this.getData(token);
        if (!data) return;

        // 4. Create Container
        const container = new PIXI.Container();

        // Scale & Positioning
        container.position.set(token.w / 2, token.h / 2);
        
        // Rotation
        if (token.mesh) {
            container.rotation = token.mesh.rotation;
        }

        token.addChildAt(container, 0);
        token.rmuZoneGraphics = container;

        // Draw Body Zone
        this.drawBodyZone(container, data.bodyRadiusPx);

        // Draw Front Indicator
        this.drawFrontArrow(container, data.bodyRadiusPx);

        // Draw Weapon Reaches
        if (data.reachRadiiPx.length > 0) {
            this.drawReachArcs(container, data.reachRadiiPx);
            
            const maxReach = Math.max(...data.reachRadiiPx);
            // Draw spokes only if reach extends beyond the body zone (plus buffer)
            if (maxReach > data.bodyRadiusPx + 1) { 
                 this.drawSectorSpokes(container, data.bodyRadiusPx, maxReach);
            }
        }
    }

    static getData(token) {
        const actor = token.actor;
        const gridDist = canvas.scene.grid.distance; 
        const gridSize = canvas.scene.grid.size;     
        const ftToPx = (ft) => (ft / gridDist) * gridSize;

        // A. Body Zone
        const bodyZoneFt = actor.system.appearance?._combatZone || 0;
        if (!bodyZoneFt) return null;

        // B. Weapon Reaches
        const reachRadii = new Set([bodyZoneFt]);
        
        if (actor.items) {
            for (const item of actor.items) {
                const sys = item.system;
                if (sys.equipped !== "equipped") continue;
                if (item.type !== "weapon" && item.type !== "shield") continue;
                
                const isMelee = sys.usages?.some(u => 
                    ["Melee Weapons", "Shield", "Martial Arts"].includes(u.trainingGroup)
                );
                if (!isMelee) continue;

                // --- DATA PARSING ---
                // Prefer derived _length (adjusted for size), fallback to raw length
                const rawVal = sys._length || sys.length || "0";
                const valStr = String(rawVal).trim();
                
                let weaponLenFt = 0;

                // Regex Patterns:
                // 1. Feet & Inches:  1'6"  or  1' 6
                const ftInPattern = /^(\d+)'(?:\s*(\d+)"?)?/;
                // 2. Just Inches:    7"
                const inPattern = /^(\d+)"/;
                // 3. Just Number:    4  or  4.5 (assumed feet)
                const numPattern = /^(\d+(?:\.\d+)?)/;

                const matchFt = valStr.match(ftInPattern);
                const matchIn = valStr.match(inPattern);
                const matchNum = valStr.match(numPattern);

                if (matchFt) {
                    // e.g. "1'6" -> 1 ft + 6/12 ft
                    const feet = parseFloat(matchFt[1]) || 0;
                    const inches = parseFloat(matchFt[2]) || 0;
                    weaponLenFt = feet + (inches / 12);
                } 
                else if (matchIn) {
                    // e.g. "7"" -> 0 ft + 7/12 ft
                    const inches = parseFloat(matchIn[1]) || 0;
                    weaponLenFt = inches / 12;
                } 
                else if (matchNum) {
                    // e.g. "4" -> 4 ft
                    weaponLenFt = parseFloat(matchNum[1]);
                }

                if (weaponLenFt > 0) {
                    reachRadii.add(bodyZoneFt + weaponLenFt);
                }
            }
        }

        return {
            bodyRadiusPx: ftToPx(bodyZoneFt),
            reachRadiiPx: Array.from(reachRadii).map(ft => ftToPx(ft)).sort((a,b) => a-b)
        };
    }

    static drawBodyZone(g, radius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);

        const drawWedge = (start, end, color) => {
            graphics.lineStyle(0); 
            graphics.beginFill(color, 0.15); 
            graphics.moveTo(0, 0); 
            graphics.arc(0, 0, radius, start, end);
            graphics.lineTo(0, 0); 
            graphics.endFill();
        };

        drawWedge(0, Math.PI, 0x00FF00); // Front
        drawWedge(Math.PI, Math.PI + Math.PI/3, 0xFFFF00); // Right
        drawWedge(-Math.PI/3, 0, 0xFFFF00); // Left
        drawWedge(Math.PI + Math.PI/3, Math.PI + 2*Math.PI/3, 0xFF0000); // Rear
    }

    static drawFrontArrow(g, radius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        
        const angle = Math.PI / 2;
        const endDist = radius * 1.0; 
        const endX = endDist * Math.cos(angle);
        const endY = endDist * Math.sin(angle);
        
        graphics.lineStyle(3, 0x00FF00, 1.0);

        const headSize = radius * 0.15;
        const leftWingAngle = angle - (Math.PI / 8); 
        const rightWingAngle = angle + (Math.PI / 8);
        
        graphics.moveTo(endX, endY);
        graphics.lineTo(
            endX - (headSize * Math.cos(leftWingAngle)), 
            endY - (headSize * Math.sin(leftWingAngle))
        );
        
        graphics.moveTo(endX, endY);
        graphics.lineTo(
            endX - (headSize * Math.cos(rightWingAngle)),
            endY - (headSize * Math.sin(rightWingAngle))
        );
    }

    static drawReachArcs(g, radii) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);

        const ranges = [
            { start: 0, end: Math.PI, color: 0x00FF00 },
            { start: Math.PI, end: Math.PI + Math.PI/3, color: 0xFFFF00 },
            { start: -Math.PI/3, end: 0, color: 0xFFFF00 },
            { start: Math.PI + Math.PI/3, end: Math.PI + 2*Math.PI/3, color: 0xFF0000 }
        ];

        radii.forEach(radius => {
            ranges.forEach(range => {
                graphics.lineStyle(3, range.color, 0.8);
                const startX = radius * Math.cos(range.start);
                const startY = radius * Math.sin(range.start);
                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, radius, range.start, range.end);
            });
        });
    }

    static drawSectorSpokes(g, innerRadius, outerRadius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);

        const boundaries = [
            0, Math.PI, -Math.PI/3, Math.PI + Math.PI/3
        ];

        graphics.lineStyle(2, 0x333333, 0.5);

        boundaries.forEach(angle => {
            const startX = innerRadius * Math.cos(angle);
            const startY = innerRadius * Math.sin(angle);
            const endX = outerRadius * Math.cos(angle);
            const endY = outerRadius * Math.sin(angle);
            graphics.moveTo(startX, startY);
            graphics.lineTo(endX, endY);
        });
    }
}

// --- Hook Registration ---

Hooks.on("refreshToken", (token) => {
    RMUZoneRenderer.update(token);
});

Hooks.on("updateActor", (actor) => {
    if (!actor) return;
    const tokens = actor.getActiveTokens();
    tokens.forEach(t => RMUZoneRenderer.update(t));
});

Hooks.on("updateItem", (item) => {
    if(item.parent) {
        const tokens = item.parent.getActiveTokens();
        tokens.forEach(t => RMUZoneRenderer.update(t));
    }
});