/**
 * src/renderer.js
 * Handles the derivation of token data and all PIXI canvas drawing operations.
 * Contains the logic for combat zones, reach rings, and the dynamic threat ruler.
 */

import { MODULE_ID, SETTINGS } from "./settings.js";

// --- Internal Constants ---

const VALID_ACTOR_TYPES = ["Character", "Creature"];
// Padding for tokens smaller than a standard grid square, matching system mechanics
const MIN_BODY_ZONE = 2.5;
const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];

/**
 * Safely triggers the system's HUD derivation logic to ensure weapon ranges are calculated.
 * Prevents concurrent derivation loops and limits execution to valid actor types.
 *
 * @param {Token} token - The token to derive data for.
 * @param {boolean} [force=false] - Whether to bypass the cache and force a re-derivation.
 */
export async function deriveDataSafe(token, force = false) {
    if (!token.actor || !VALID_ACTOR_TYPES.includes(token.actor.type)) return;

    if (force) token._rmuDerived = false;
    if (typeof token.document.hudDeriveExtendedData !== "function") return;
    if (token._rmuDeriving) return;
    if (token._rmuDerived && !force) return;

    token._rmuDeriving = true;
    try {
        await token.document.hudDeriveExtendedData();
        // Ensure the token wasn't deleted mid-derivation
        if (token.destroyed || !token.document) return;

        token._rmuDerived = true;
        token._rmuDirty = true;
        RMUZoneRenderer.update(token);
    } catch (err) {
        console.warn("RMU Zones | Derivation failed:", err);
    } finally {
        if (!token.destroyed) token._rmuDeriving = false;
    }
}

/**
 * Main rendering class for RMU Combat Zones.
 */
export class RMUZoneRenderer {
    static hoveredToken = null;

    /**
     * Safely converts Foundry V13 Color objects or string hex codes into PIXI-compatible integers.
     * * @param {Color|string|number} colorValue - The raw colour data from game settings.
     * @returns {number} The parsed hex integer (e.g., 0x00FF00).
     */
    static parseColor(colorValue) {
        if (typeof colorValue === "number") return colorValue;
        if (colorValue?.valueOf) return colorValue.valueOf();
        if (typeof colorValue === "string") return parseInt(colorValue.replace("#", ""), 16);
        return 0x000000;
    }

    /**
     * Primary rendering loop. Evaluates visibility, calculates geometry, and draws PIXI graphics.
     * Uses a caching system to prevent unnecessary redraws.
     * * @param {Token} token - The token to update.
     */
    static update(token) {
        // Safety & Validation checks
        if (!token.visible || !token.actor || !canvas.scene || !VALID_ACTOR_TYPES.includes(token.actor.type)) {
            this.clear(token);
            return;
        }

        if (!game.settings.settings.has(`${MODULE_ID}.${SETTINGS.TOGGLE}`)) return;
        if (!game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
            this.clear(token);
            return;
        }

        const dataSource = token.isPreview && token._original ? token._original : token;

        // --- Smart Reach Logic ---
        // Determines if reach rings should be drawn based on user settings and token state.
        const showAllReach = game.settings.get(MODULE_ID, SETTINGS.REACH_SHOW_ALL);
        let showReach = showAllReach || dataSource.hover || dataSource.controlled || (!game.user.isGM && dataSource.document.isOwner);

        // Parse colours for PIXI
        const drawConfig = {
            front: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT)),
            flank: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK)),
            rear: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR)),
            spoke: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE)),
            facing: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_FACING)),
            alpha: game.settings.get(MODULE_ID, SETTINGS.ALPHA),
        };

        const rawBodyZone = Number(dataSource.actor.system.appearance?._combatZone) || 0;
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        // Handle Metric to Imperial conversions for the grid distance
        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const metricFactor = game.settings.get(MODULE_ID, SETTINGS.METRIC_FACTOR);
        const rawGridDist = canvas.scene.grid.distance;
        const gridDistInFeet = isMetric ? rawGridDist * metricFactor : rawGridDist;
        const gridData = {
            gridDist: gridDistInFeet,
            gridSize: canvas.scene.grid.size,
        };

        const rotation = token.document.rotation;
        const weaponData = this.getWeaponReaches(dataSource, bodyZoneFt);
        const reachValues = weaponData.map((w) => w.reach);
        const showLabels = game.settings.get(MODULE_ID, SETTINGS.SHOW_LABELS);

        // --- Dynamic Label Placement ---
        // Adjusts where the labels are drawn to avoid overlapping the hovered target token
        let labelPlacement = "top";
        if (RMUZoneRenderer.hoveredToken && canvas.tokens.controlled.includes(token)) {
            const dy = RMUZoneRenderer.hoveredToken.center.y - token.center.y;
            if (dy < 0) {
                labelPlacement = "bottom";
            }
        }

        // Create a hash representing the current visual state configuration
        const configHash = JSON.stringify(drawConfig) + `|${showReach}|${showLabels}|${labelPlacement}`;

        // Optimisation: Only redraw if the token's geometry, state, or the module settings have changed
        if (!token._rmuDirty && token._rmuLastState?.rotation === rotation && token._rmuLastState?.configHash === configHash && this.arraysEqual(token._rmuLastState?.reaches, reachValues)) {
            return;
        }

        // --- PIXI Container Management ---
        let container = token.rmuZoneGraphics;
        let graphics;

        if (!container) {
            container = new PIXI.Container();
            token.addChildAt(container, 0);
            token.rmuZoneGraphics = container;
            graphics = new PIXI.Graphics();
            container.addChild(graphics);
            container.zoneGraphics = graphics;
        } else {
            graphics = container.zoneGraphics;
            graphics.clear();

            // Selectively destroy text labels while reusing the main graphics object to save memory
            for (let i = container.children.length - 1; i >= 0; i--) {
                if (container.children[i] instanceof PIXI.Text) {
                    container.children[i].destroy();
                }
            }
        }

        container.alpha = 1.0;
        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);

        this.drawBodyZone(graphics, bodyRadiusPx, drawConfig);
        this.drawFrontArrow(graphics, bodyRadiusPx, drawConfig);

        // Conditionally draw reach arcs and associated data
        if (showReach && reachValues.length > 0) {
            const reachRadiiPx = reachValues.map((ft) => this.ftToPx(ft, gridData));
            this.drawReachArcs(graphics, reachRadiiPx, drawConfig);

            if (showLabels) {
                this.drawRingLabels(container, weaponData, gridData, labelPlacement, rotation);
            }

            const maxReachPx = Math.max(...reachRadiiPx);
            if (maxReachPx > bodyRadiusPx + 1) {
                this.drawSectorSpokes(graphics, bodyRadiusPx, maxReachPx, drawConfig);
            }
        }

        // Cache the current state to prevent redundant future redraws
        token._rmuLastState = {
            rotation,
            width: token.w,
            height: token.h,
            reaches: reachValues,
            configHash,
        };
        token._rmuDirty = false;
    }

    /**
     * Completely removes and destroys all PIXI graphics associated with the module on a token.
     * * @param {Token} token - The token to clear.
     */
    static clear(token) {
        if (token.rmuZoneGraphics) {
            token.rmuZoneGraphics.destroy({ children: true });
            token.rmuZoneGraphics = null;
            token._rmuLastState = null;
        }
    }

    /**
     * Extracts and calculates the reach distances and names of all equipped melee weapons.
     * Consolidates duplicate ranges (e.g., if two weapons have a 5ft reach).
     * * @param {Token} token - The token whose weapons to evaluate.
     * @param {number} bodyZoneFt - The token's base body zone radius.
     * @returns {Array<{reach: number, name: string}>} Sorted array of reach objects.
     */
    static getWeaponReaches(token, bodyZoneFt) {
        const reachMap = new Map();
        reachMap.set(bodyZoneFt, "Combat Zone");

        const attacks = token.actor.system._attacks;

        if (Array.isArray(attacks) && attacks.length > 0) {
            for (const att of attacks) {
                if (att.isEquipped === false) continue;
                if (att.isRanged === true) continue;

                const range = att.meleeRange;
                if (typeof range === "number" && range > 0) {
                    const actualReach = Math.max(range, bodyZoneFt);
                    const currentName = reachMap.get(actualReach);
                    const weaponName = att.attackName || "Weapon";

                    // Concatenate names if multiple weapons share the exact same reach
                    if (currentName && currentName !== "Combat Zone") {
                        if (!currentName.includes(weaponName)) {
                            reachMap.set(actualReach, `${currentName}, ${weaponName}`);
                        }
                    } else {
                        reachMap.set(actualReach, weaponName);
                    }
                }
            }
        }

        return Array.from(reachMap.entries())
            .map(([reach, name]) => ({ reach, name }))
            .sort((a, b) => a.reach - b.reach);
    }

    /**
     * Converts a distance in feet to a distance in canvas pixels.
     */
    static ftToPx(ft, gridData) {
        return (ft / gridData.gridDist) * gridData.gridSize;
    }

    /**
     * Checks if two arrays contain identical values in the same order.
     */
    static arraysEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Defines the geometry for the Front, Flank, and Rear combat arcs.
     */
    static getZones(config) {
        return [
            { start: 0, end: Math.PI, color: config.front },
            { start: Math.PI, end: Math.PI + Math.PI / 3, color: config.flank },
            { start: -Math.PI / 3, end: 0, color: config.flank },
            {
                start: Math.PI + Math.PI / 3,
                end: Math.PI + (2 * Math.PI) / 3,
                color: config.rear,
            },
        ];
    }

    static drawBodyZone(graphics, radius, config) {
        const zones = this.getZones(config);
        zones.forEach((zone) => {
            graphics.lineStyle(0);
            graphics.beginFill(zone.color, config.alpha);
            graphics.moveTo(0, 0);
            graphics.arc(0, 0, radius, zone.start, zone.end);
            graphics.lineTo(0, 0);
            graphics.endFill();
        });
    }

    static drawFrontArrow(graphics, radius, config) {
        const offset = 5;
        const startY = radius + offset;
        const height = radius * 0.2;
        const width = height * 1.5;

        graphics.lineStyle(4, config.facing, 1.0);
        graphics.beginFill(config.facing, 0.25);
        graphics.moveTo(-width / 2, startY);
        graphics.lineTo(0, startY + height);
        graphics.lineTo(width / 2, startY);
        graphics.closePath();
        graphics.endFill();
    }

    /**
     * Draws horizontal text labels indicating weapon names onto their respective reach rings.
     * Counter-rotates the text so it remains readable regardless of token facing.
     */
    static drawRingLabels(container, weapons, gridData, placement, rotationDeg) {
        const textStyle = new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 14,
            fill: "#FFFFFF",
            stroke: "#000000",
            strokeThickness: 3,
        });

        const rotationRad = Math.toRadians(rotationDeg);
        const screenAngle = placement === "top" ? -Math.PI / 2 : Math.PI / 2;
        const localAngle = screenAngle - rotationRad;

        weapons.forEach((weapon) => {
            if (!weapon.name || weapon.name === "Combat Zone") return;

            const radiusPx = this.ftToPx(weapon.reach, gridData);
            const offset = 3 / 2;
            const displayRadiusPx = radiusPx - offset;

            const paddingPx = 4;
            const labelRadiusPx = displayRadiusPx + paddingPx;

            const label = new PIXI.Text(weapon.name, textStyle);

            label.x = Math.cos(localAngle) * labelRadiusPx;
            label.y = Math.sin(localAngle) * labelRadiusPx;
            label.rotation = -rotationRad;

            if (placement === "top") {
                label.anchor.set(0, 1);
            } else {
                label.anchor.set(0, 0);
            }

            container.addChild(label);
        });
    }

    static drawReachArcs(graphics, radiiPx, config) {
        const zones = this.getZones(config);
        const width = 3;
        const offset = width / 2;

        radiiPx.forEach((radiusPx) => {
            // Draw lines inside the radius to prevent visual bleeding
            const drawRadiusPx = radiusPx - offset;
            zones.forEach((zone) => {
                graphics.lineStyle(width, zone.color, 0.8);
                const startX = drawRadiusPx * Math.cos(zone.start);
                const startY = drawRadiusPx * Math.sin(zone.start);
                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, drawRadiusPx, zone.start, zone.end);
            });
        });
    }

    static drawSectorSpokes(graphics, innerRadius, outerRadius, config) {
        graphics.lineStyle(2, config.spoke, 0.5);
        const boundaries = [0, Math.PI, -Math.PI / 3, Math.PI + Math.PI / 3];
        boundaries.forEach((angle) => {
            graphics.moveTo(innerRadius * Math.cos(angle), innerRadius * Math.sin(angle));
            graphics.lineTo(outerRadius * Math.cos(angle), outerRadius * Math.sin(angle));
        });
    }

    /**
     * Calculates the relative angle between an attacker and a target to determine
     * which combat zone (Front, Flank, Rear) the target currently occupies.
     * * @returns {number} The hex colour of the calculated zone.
     */
    static getZoneColorForAngle(sourceToken, targetToken, drawConfig) {
        const dx = targetToken.center.x - sourceToken.center.x;
        const dy = targetToken.center.y - sourceToken.center.y;

        // Subtract source token rotation to normalize coordinates to token-space
        let relativeAngle = Math.atan2(dy, dx) - Math.toRadians(sourceToken.document.rotation);

        // Normalise angle to be within -PI and PI
        while (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
        while (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

        const zones = this.getZones(drawConfig);
        for (const zone of zones) {
            if (relativeAngle >= zone.start && relativeAngle <= zone.end) return zone.color;
        }
        return drawConfig.front;
    }

    /**
     * Renders a dynamic 3D-to-2D projection of reach distances between an attacker and a target.
     * Draws underlying antennae and overlaying chevrons to indicate hit/miss status.
     * * @param {Token} targetToken - The token currently being hovered over.
     * @param {boolean} isHovered - Whether the target is actively hovered.
     */
    static drawThreatRulerOverlay(targetToken, isHovered) {
        const previousTarget = this.hoveredToken;
        this.hoveredToken = isHovered ? targetToken : null;

        const controlled = canvas.tokens.controlled;

        if (previousTarget !== this.hoveredToken) {
            controlled.forEach((t) => this.update(t));
        }

        if (canvas.primary.rmuThreatRuler) {
            canvas.primary.rmuThreatRuler.destroy({ children: true });
            canvas.primary.rmuThreatRuler = null;
        }
        if (canvas.controls.rmuThreatRuler) {
            canvas.controls.rmuThreatRuler.destroy({ children: true });
            canvas.controls.rmuThreatRuler = null;
        }

        if (!game.settings.get(MODULE_ID, SETTINGS.SHOW_THREAT_RULER)) {
            return;
        }

        if (!isHovered || !targetToken || controlled.length === 0 || controlled.includes(targetToken)) {
            return;
        }

        // Layer 1: Antennas drawn underneath tokens
        const bgOverlay = new PIXI.Graphics();
        bgOverlay.zIndex = -1;
        canvas.primary.addChild(bgOverlay);
        canvas.primary.rmuThreatRuler = bgOverlay;

        // Layer 2: Chevrons drawn on top of tokens
        const fgOverlay = new PIXI.Graphics();
        fgOverlay.zIndex = 1000;
        canvas.controls.addChild(fgOverlay);
        canvas.controls.rmuThreatRuler = fgOverlay;

        const drawConfig = {
            front: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT)),
            flank: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK)),
            rear: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR)),
            spoke: this.parseColor(game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE)),
        };

        const missColorHex = drawConfig.spoke || 0x333333;

        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const metricFactor = game.settings.get(MODULE_ID, SETTINGS.METRIC_FACTOR);
        const gridData = {
            gridDist: isMetric ? canvas.scene.grid.distance * metricFactor : canvas.scene.grid.distance,
            gridSize: canvas.scene.grid.size,
        };

        const getElevationFt = (t) => {
            const e = t.document.elevation || 0;
            return isMetric ? e * metricFactor : e;
        };

        const targetZ = getElevationFt(targetToken);
        const targetZoneFt = Math.max(Number(targetToken.actor?.system.appearance?._combatZone) || 0, MIN_BODY_ZONE);
        const targetZonePx = this.ftToPx(targetZoneFt, gridData);

        controlled.forEach((attacker) => {
            const bodyZoneFt = Math.max(Number(attacker.actor?.system.appearance?._combatZone) || 0, MIN_BODY_ZONE);
            const weapons = this.getWeaponReaches(attacker, bodyZoneFt);

            // Calculate 2D hypotenuse (X and Y distance)
            const dx = targetToken.center.x - attacker.center.x;
            const dy = targetToken.center.y - attacker.center.y;
            const distance2DPx = Math.sqrt(dx * dx + dy * dy);

            // Calculate 3D hypotenuse (including Z elevation)
            const attackerZ = getElevationFt(attacker);
            const dzPx = this.ftToPx(Math.abs(attackerZ - targetZ), gridData);
            const distance3DPx = Math.sqrt(distance2DPx * distance2DPx + dzPx * dzPx);

            if (distance3DPx === 0) return;

            // Projection Ratio scales the 3D distance back down to the 2D canvas
            // so indicators shrink visually when aiming up/down
            const projectionRatio = distance2DPx / distance3DPx;
            const angle = Math.atan2(dy, dx);

            const hitColorHex = this.getZoneColorForAngle(attacker, targetToken, drawConfig);

            // --- 1. Defender's Antenna ---
            const defAntennaLengthPx = targetZonePx * projectionRatio;
            const defEndX = targetToken.center.x - Math.cos(angle) * defAntennaLengthPx;
            const defEndY = targetToken.center.y - Math.sin(angle) * defAntennaLengthPx;

            bgOverlay.lineStyle(3, missColorHex, 0.8);
            bgOverlay.moveTo(targetToken.center.x, targetToken.center.y);
            bgOverlay.lineTo(defEndX, defEndY);

            const shieldSize = 14;
            bgOverlay.lineStyle(4, missColorHex, 1.0);
            bgOverlay.moveTo(defEndX + Math.cos(angle + Math.PI / 2) * shieldSize, defEndY + Math.sin(angle + Math.PI / 2) * shieldSize);
            bgOverlay.lineTo(defEndX + Math.cos(angle - Math.PI / 2) * shieldSize, defEndY + Math.sin(angle - Math.PI / 2) * shieldSize);

            // --- 2. Attacker's Antenna ---
            const maxWeaponReachFt = Math.max(...weapons.map((w) => w.reach));
            const maxReachPx = this.ftToPx(maxWeaponReachFt, gridData);
            const attAntennaLengthPx = maxReachPx * projectionRatio;

            const attEndX = attacker.center.x + Math.cos(angle) * attAntennaLengthPx;
            const attEndY = attacker.center.y + Math.sin(angle) * attAntennaLengthPx;

            bgOverlay.lineStyle(3, missColorHex, 0.8);
            bgOverlay.moveTo(attacker.center.x, attacker.center.y);
            bgOverlay.lineTo(attEndX, attEndY);

            // --- 3. Hit/Miss Chevrons ---
            weapons.forEach((weapon) => {
                const weaponReachPx = this.ftToPx(weapon.reach, gridData);

                // Determine if this specific weapon's reach overlaps the defender's combat zone
                const isHit = weaponReachPx + targetZonePx >= distance3DPx;
                const color = isHit ? hitColorHex : missColorHex;
                const thickness = isHit ? 6 : 4;
                const size = 12;

                const chevronDistPx = weaponReachPx * projectionRatio;
                const cx = attacker.center.x + Math.cos(angle) * chevronDistPx;
                const cy = attacker.center.y + Math.sin(angle) * chevronDistPx;

                fgOverlay.lineStyle(thickness, color, 1.0);
                fgOverlay.moveTo(cx - Math.cos(angle - Math.PI / 4) * size, cy - Math.sin(angle - Math.PI / 4) * size);
                fgOverlay.lineTo(cx, cy);
                fgOverlay.lineTo(cx - Math.cos(angle + Math.PI / 4) * size, cy - Math.sin(angle + Math.PI / 4) * size);
            });
        });
    }
}
