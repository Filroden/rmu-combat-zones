/**
 * src/renderer.js
 * Handles the derivation of token data and all PIXI canvas drawing operations.
 */

import { MODULE_ID, SETTINGS } from "./settings.js";

// --- Internal Constants ---
const VALID_ACTOR_TYPES = ["Character", "Creature"];
const MIN_BODY_ZONE = 2.5;
const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];

/**
 * Safely requests the system to calculate the latest token data.
 * Includes safeguards against asynchronous race conditions if a token is deleted.
 */
export async function deriveDataSafe(token, force = false) {
    // Abort if there is no actor or the actor type is not valid
    if (!token.actor || !VALID_ACTOR_TYPES.includes(token.actor.type)) return;

    if (force) token._rmuDerived = false;
    if (typeof token.document.hudDeriveExtendedData !== "function") return;
    if (token._rmuDeriving) return;
    if (token._rmuDerived && !force) return;

    token._rmuDeriving = true;
    try {
        await token.document.hudDeriveExtendedData();

        // Prevent modification or rendering if the token was deleted while awaiting derivation
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
 * Manages the drawing and clearing of combat zones on the canvas.
 */
export class RMUZoneRenderer {
    static update(token) {
        if (
            !token.visible ||
            !token.actor ||
            !canvas.scene ||
            !VALID_ACTOR_TYPES.includes(token.actor.type)
        ) {
            this.clear(token);
            return;
        }

        if (!game.settings.settings.has(`${MODULE_ID}.${SETTINGS.TOGGLE}`))
            return;
        const show = game.settings.get(MODULE_ID, SETTINGS.TOGGLE);
        if (!show) {
            this.clear(token);
            return;
        }

        // --- Edge Case: Unlinked Drag Clones ---
        // Preview clones of unlinked tokens lack derived synthetic actor data.
        // Route all data requests to the original token.
        const dataSource =
            token.isPreview && token._original ? token._original : token;

        // --- Smart Reach Logic ---
        const showAllReach = game.settings.get(
            MODULE_ID,
            SETTINGS.REACH_SHOW_ALL,
        );
        let showReach = false;

        if (showAllReach) {
            showReach = true;
        } else {
            if (dataSource.hover || dataSource.controlled) {
                showReach = true;
            } else if (!game.user.isGM && dataSource.document.isOwner) {
                showReach = true;
            }
        }

        // Retrieve colour configurations
        const drawConfig = {
            front: game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT),
            flank: game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK),
            rear: game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR),
            spoke: game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE),
            facing: game.settings.get(MODULE_ID, SETTINGS.COLOR_FACING),
            alpha: game.settings.get(MODULE_ID, SETTINGS.ALPHA),
        };

        // Pull the combat zone from the dataSource
        const rawBodyZone =
            Number(dataSource.actor.system.appearance?._combatZone) || 0;
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        const rotation = token.document.rotation;
        const width = token.w;
        const height = token.h;
        const weaponReaches = this.getWeaponReaches(dataSource, bodyZoneFt);

        const configHash = JSON.stringify(drawConfig) + `|${showReach}`;

        if (
            !token._rmuDirty &&
            token._rmuLastState?.rotation === rotation &&
            token._rmuLastState?.width === width &&
            token._rmuLastState?.height === height &&
            token._rmuLastState?.configHash === configHash &&
            this.arraysEqual(token._rmuLastState?.reaches, weaponReaches)
        ) {
            return;
        }

        // Single PIXI.Graphics initialisation for performance
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
        }

        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const rawGridDist = canvas.scene.grid.distance;
        const gridDistInFeet = isMetric
            ? rawGridDist * game.settings.get(MODULE_ID, SETTINGS.METRIC_FACTOR)
            : rawGridDist;

        const gridData = {
            gridDist: gridDistInFeet,
            gridSize: canvas.scene.grid.size,
        };

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);

        this.drawBodyZone(graphics, bodyRadiusPx, drawConfig);
        this.drawFrontArrow(graphics, bodyRadiusPx, drawConfig);

        if (showReach && weaponReaches.length > 0) {
            const reachRadiiPx = weaponReaches.map((ft) =>
                this.ftToPx(ft, gridData),
            );
            this.drawReachArcs(graphics, reachRadiiPx, drawConfig);

            const maxReach = Math.max(...reachRadiiPx);
            if (maxReach > bodyRadiusPx + 1) {
                this.drawSectorSpokes(
                    graphics,
                    bodyRadiusPx,
                    maxReach,
                    drawConfig,
                );
            }
        }

        token._rmuLastState = {
            rotation,
            width,
            height,
            reaches: weaponReaches,
            configHash,
        };
        token._rmuDirty = false;
    }

    static clear(token) {
        if (token.rmuZoneGraphics) {
            token.rmuZoneGraphics.destroy({ children: true });
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
        return Array.from(reachRadii).sort((a, b) => a - b);
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

        const tipY = startY + height;
        const tipX = 0;
        const baseLeftX = -width / 2;
        const baseLeftY = startY;
        const baseRightX = width / 2;
        const baseRightY = startY;

        graphics.lineStyle(4, config.facing, 1.0);
        graphics.beginFill(config.facing, 0.25);

        graphics.moveTo(baseLeftX, baseLeftY);
        graphics.lineTo(tipX, tipY);
        graphics.lineTo(baseRightX, baseRightY);
        graphics.closePath();

        graphics.endFill();
    }

    static drawReachArcs(graphics, radii, config) {
        const zones = this.getZones(config);
        const width = 3;
        const offset = width / 2;

        radii.forEach((radius) => {
            const drawRadius = radius - offset;

            zones.forEach((zone) => {
                graphics.lineStyle(width, zone.color, 0.8);

                const startX = drawRadius * Math.cos(zone.start);
                const startY = drawRadius * Math.sin(zone.start);

                graphics.moveTo(startX, startY);
                graphics.arc(0, 0, drawRadius, zone.start, zone.end);
            });
        });
    }

    static drawSectorSpokes(graphics, innerRadius, outerRadius, config) {
        graphics.lineStyle(2, config.spoke, 0.5);

        const boundaries = [0, Math.PI, -Math.PI / 3, Math.PI + Math.PI / 3];
        boundaries.forEach((angle) => {
            graphics.moveTo(
                innerRadius * Math.cos(angle),
                innerRadius * Math.sin(angle),
            );
            graphics.lineTo(
                outerRadius * Math.cos(angle),
                outerRadius * Math.sin(angle),
            );
        });
    }
}
