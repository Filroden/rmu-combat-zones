/**
 * RMU Combat Zones
 * A module to visualize combat facings and weapon reach in Foundry V13.
 */

const MODULE_ID = "rmu-combat-zones";
const SETTING_TOGGLE = "showZones";

// --- Initialization ---

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING_TOGGLE, {
        name: "Show Combat Zones",
        hint: "Toggle the visualization of RMU combat zones and reach arcs.",
        scope: "client",
        config: true,         // Still visible in menu, but managed via HUD now
        type: Boolean,
        default: true,
        onChange: () => {
            // Force a full redraw on all tokens when toggled
            canvas.tokens.placeables.forEach(t => RMUZoneRenderer.update(t));
        }
    });
});

// --- Scene Controls (The HUD Button) ---

Hooks.on("getSceneControlButtons", (controls) => {
    // V13: Access the layer directly by key
    const tokenLayer = controls.tokens;

    if (tokenLayer) {
        // Define the tool definition
        const rmuTool = {
            name: "rmu-zones",
            title: "Toggle Combat Zones",
            icon: "fas fa-bullseye",
            toggle: true,
            active: game.settings.get(MODULE_ID, SETTING_TOGGLE),
            onClick: (toggled) => {
                game.settings.set(MODULE_ID, SETTING_TOGGLE, toggled);
            }
        };

        // V13 Compatibility Check:
        // If 'tools' is an Array (Legacy/Shim), use push.
        // If 'tools' is an Object (New V13 Standard), assign by key.
        if (Array.isArray(tokenLayer.tools)) {
            tokenLayer.tools.push(rmuTool);
        } else {
            // Assign to the object dictionary
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
        if (!show || !token.actor || !token.visible) return;

        // 3. Gather Data
        const data = this.getData(token);
        if (!data) return;

        // 4. Create Container
        const container = new PIXI.Container();

        // Scale & Positioning (Token Parent)
        container.position.set(token.w / 2, token.h / 2);
        
        // Rotation (Sync with Mesh)
        if (token.mesh) {
            container.rotation = token.mesh.rotation;
        }

        token.addChildAt(container, 0);
        token.rmuZoneGraphics = container;

        // Draw the Body Zone (Filled Wedges)
        this.drawBodyZone(container, data.bodyRadiusPx);

        // Draw Front Arrow (New Feature)
        this.drawFrontArrow(container, data.bodyRadiusPx);

        // Draw Weapon Reaches (Arcs + Spokes)
        if (token.isOwner && data.reachRadiiPx.length > 0) {
            this.drawReachArcs(container, data.reachRadiiPx);
            
            const maxReach = Math.max(...data.reachRadiiPx);
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

                let rawLength = sys._length || sys.length || "0";
                if (typeof rawLength === "string") {
                    rawLength = rawLength.replace(/[^0-9.]/g, '');
                }
                const weaponLenFt = parseFloat(rawLength);

                if (!isNaN(weaponLenFt)) {
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

        // Front (Green) - 0 to PI (South Hemisphere)
        drawWedge(0, Math.PI, 0x00FF00);
        // Right Flank (Yellow)
        drawWedge(Math.PI, Math.PI + Math.PI/3, 0xFFFF00);
        // Left Flank (Yellow)
        drawWedge(-Math.PI/3, 0, 0xFFFF00);
        // Rear (Red)
        drawWedge(Math.PI + Math.PI/3, Math.PI + 2*Math.PI/3, 0xFF0000);
    }

    /**
     * Draws a visual indicator of the exact center front
     */
    static drawFrontArrow(g, radius) {
        const graphics = new PIXI.Graphics();
        g.addChild(graphics);
        
        // Center Front is PI/2 (South) because our Front wedge is 0 to PI.
        const angle = Math.PI / 2;
        
        // Define Arrow Geometry
        // Start slightly inside the zone, end slightly outside
        const startDist = radius * 0.5;
        const endDist = radius * 1.0; 
        
        // Calculate points
        const startX = startDist * Math.cos(angle);
        const startY = startDist * Math.sin(angle);
        const endX = endDist * Math.cos(angle);
        const endY = endDist * Math.sin(angle);
        
        // Draw Shaft
        graphics.lineStyle(2, 0xFFFFFF, 0.8); // White, mostly opaque
        graphics.moveTo(startX, startY);
        graphics.lineTo(endX, endY);
        
        // Draw Arrowhead (Simple V shape) at the end
        // We offset the angle by a small amount (+/- 15 degrees)
        const headSize = radius * 0.15;
        const leftWingAngle = angle - (Math.PI / 8); 
        const rightWingAngle = angle + (Math.PI / 8);
        
        // Left wing
        graphics.moveTo(endX, endY);
        graphics.lineTo(
            endX - (headSize * Math.cos(leftWingAngle)), // Subtract because we want to go "back"
            endY - (headSize * Math.sin(leftWingAngle))
        );
        
        // Right wing
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