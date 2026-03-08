/**
 * src/renderer.js
 * Handles the derivation of token data and all PIXI canvas drawing operations.
 */

import { MODULE_ID, SETTINGS } from "./settings.js";

// --- Internal Constants ---
const VALID_ACTOR_TYPES = ["Character", "Creature"];
const MIN_BODY_ZONE = 2.5;
const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];

export async function deriveDataSafe(token, force = false) {
    if (!token.actor || !VALID_ACTOR_TYPES.includes(token.actor.type)) return;

    if (force) token._rmuDerived = false;
    if (typeof token.document.hudDeriveExtendedData !== "function") return;
    if (token._rmuDeriving) return;
    if (token._rmuDerived && !force) return;

    token._rmuDeriving = true;
    try {
        await token.document.hudDeriveExtendedData();
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

export class RMUZoneRenderer {
    static hoveredToken = null;

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
        if (!game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
            this.clear(token);
            return;
        }

        const dataSource =
            token.isPreview && token._original ? token._original : token;
        const showAllReach = game.settings.get(
            MODULE_ID,
            SETTINGS.REACH_SHOW_ALL,
        );
        let showReach =
            showAllReach ||
            dataSource.hover ||
            dataSource.controlled ||
            (!game.user.isGM && dataSource.document.isOwner);

        const drawConfig = {
            front: game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT),
            flank: game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK),
            rear: game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR),
            spoke: game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE),
            facing: game.settings.get(MODULE_ID, SETTINGS.COLOR_FACING),
            alpha: game.settings.get(MODULE_ID, SETTINGS.ALPHA),
        };

        const rawBodyZone =
            Number(dataSource.actor.system.appearance?._combatZone) || 0;
        const bodyZoneFt = Math.max(rawBodyZone, MIN_BODY_ZONE);

        if (!bodyZoneFt) {
            this.clear(token);
            return;
        }

        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const metricFactor = game.settings.get(
            MODULE_ID,
            SETTINGS.METRIC_FACTOR,
        );
        const rawGridDist = canvas.scene.grid.distance;
        const gridDistInFeet = isMetric
            ? rawGridDist * metricFactor
            : rawGridDist;
        const gridData = {
            gridDist: gridDistInFeet,
            gridSize: canvas.scene.grid.size,
        };

        const rotation = token.document.rotation;

        // Retrieve weapon data objects { reach, name }
        const weaponData = this.getWeaponReaches(dataSource, bodyZoneFt);
        const reachValues = weaponData.map((w) => w.reach);
        const configHash = JSON.stringify(drawConfig) + `|${showReach}`;

        if (
            !token._rmuDirty &&
            token._rmuLastState?.rotation === rotation &&
            token._rmuLastState?.configHash === configHash &&
            this.arraysEqual(token._rmuLastState?.reaches, reachValues)
        ) {
            return;
        }

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

        container.alpha = 1.0;

        container.position.set(token.w / 2, token.h / 2);
        container.rotation = Math.toRadians(rotation);

        const bodyRadiusPx = this.ftToPx(bodyZoneFt, gridData);

        this.drawBodyZone(graphics, bodyRadiusPx, drawConfig);
        this.drawFrontArrow(graphics, bodyRadiusPx, drawConfig);

        if (showReach && reachValues.length > 0) {
            const reachRadiiPx = reachValues.map((ft) =>
                this.ftToPx(ft, gridData),
            );
            this.drawReachArcs(graphics, reachRadiiPx, drawConfig);

            const maxReachPx = Math.max(...reachRadiiPx);
            if (maxReachPx > bodyRadiusPx + 1) {
                this.drawSectorSpokes(
                    graphics,
                    bodyRadiusPx,
                    maxReachPx,
                    drawConfig,
                );
            }
        }

        token._rmuLastState = {
            rotation,
            width: token.w,
            height: token.h,
            reaches: reachValues,
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

    /**
     * Extracts weapon reaches and names for labelling.
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

                    if (currentName && currentName !== "Combat Zone") {
                        if (!currentName.includes(weaponName)) {
                            reachMap.set(
                                actualReach,
                                `${currentName}, ${weaponName}`,
                            );
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

        graphics.lineStyle(4, config.facing, 1.0);
        graphics.beginFill(config.facing, 0.25);
        graphics.moveTo(-width / 2, startY);
        graphics.lineTo(0, startY + height);
        graphics.lineTo(width / 2, startY);
        graphics.closePath();
        graphics.endFill();
    }

    static drawReachArcs(graphics, radiiPx, config) {
        const zones = this.getZones(config);
        const width = 3;
        const offset = width / 2;

        radiiPx.forEach((radiusPx) => {
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

    static getZoneColorForAngle(sourceToken, targetToken, drawConfig) {
        const dx = targetToken.center.x - sourceToken.center.x;
        const dy = targetToken.center.y - sourceToken.center.y;
        let relativeAngle =
            Math.atan2(dy, dx) - Math.toRadians(sourceToken.document.rotation);

        while (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
        while (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

        const zones = this.getZones(drawConfig);
        for (const zone of zones) {
            if (relativeAngle >= zone.start && relativeAngle <= zone.end)
                return zone.color;
        }
        return drawConfig.front;
    }

    /**
     * Renders the dynamic Antenna and Chevron system UNDER the tokens.
     */
    static drawThreatRulerOverlay(targetToken, isHovered) {
        this.hoveredToken = isHovered ? targetToken : null;

        // Clear BOTH overlays if they exist
        if (canvas.primary.rmuThreatRuler) {
            canvas.primary.rmuThreatRuler.destroy({ children: true });
            canvas.primary.rmuThreatRuler = null;
        }
        if (canvas.controls.rmuThreatRuler) {
            canvas.controls.rmuThreatRuler.destroy({ children: true });
            canvas.controls.rmuThreatRuler = null;
        }

        const controlled = canvas.tokens.controlled;

        if (
            !isHovered ||
            !targetToken ||
            controlled.length === 0 ||
            controlled.includes(targetToken)
        ) {
            return;
        }

        // --- LAYER 1: Background (Lines under tokens) ---
        const bgOverlay = new PIXI.Graphics();
        bgOverlay.zIndex = -1;
        canvas.primary.addChild(bgOverlay);
        canvas.primary.rmuThreatRuler = bgOverlay;

        // --- LAYER 2: Foreground (Data over tokens) ---
        const fgOverlay = new PIXI.Graphics();
        fgOverlay.zIndex = 1000;
        canvas.controls.addChild(fgOverlay);
        canvas.controls.rmuThreatRuler = fgOverlay;

        const drawConfig = {
            front: game.settings.get(MODULE_ID, SETTINGS.COLOR_FRONT),
            flank: game.settings.get(MODULE_ID, SETTINGS.COLOR_FLANK),
            rear: game.settings.get(MODULE_ID, SETTINGS.COLOR_REAR),
            spoke: game.settings.get(MODULE_ID, SETTINGS.COLOR_SPOKE),
        };

        const missColorHex =
            typeof drawConfig.spoke === "string"
                ? parseInt(drawConfig.spoke.replace("#", "0x"))
                : 0x333333;

        const units = canvas.scene.grid.units?.toLowerCase().trim() || "";
        const isMetric = METRIC_UNITS.includes(units);
        const metricFactor = game.settings.get(
            MODULE_ID,
            SETTINGS.METRIC_FACTOR,
        );
        const gridData = {
            gridDist: isMetric
                ? canvas.scene.grid.distance * metricFactor
                : canvas.scene.grid.distance,
            gridSize: canvas.scene.grid.size,
        };

        const getElevationFt = (t) => {
            const e = t.document.elevation || 0;
            return isMetric ? e * metricFactor : e;
        };

        const targetZ = getElevationFt(targetToken);
        const targetZoneFt = Math.max(
            Number(targetToken.actor?.system.appearance?._combatZone) || 0,
            MIN_BODY_ZONE,
        );
        const targetZonePx = this.ftToPx(targetZoneFt, gridData);

        const textStyle = new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 14,
            fill: "#FFFFFF",
            stroke: "#000000",
            strokeThickness: 3,
        });

        controlled.forEach((attacker) => {
            const bodyZoneFt = Math.max(
                Number(attacker.actor?.system.appearance?._combatZone) || 0,
                MIN_BODY_ZONE,
            );
            const weapons = this.getWeaponReaches(attacker, bodyZoneFt);

            const dx = targetToken.center.x - attacker.center.x;
            const dy = targetToken.center.y - attacker.center.y;
            const distance2DPx = Math.sqrt(dx * dx + dy * dy);

            const attackerZ = getElevationFt(attacker);
            const dzPx = this.ftToPx(Math.abs(attackerZ - targetZ), gridData);
            const distance3DPx = Math.sqrt(
                distance2DPx * distance2DPx + dzPx * dzPx,
            );

            if (distance3DPx === 0) return;

            const projectionRatio = distance2DPx / distance3DPx;
            const angle = Math.atan2(dy, dx);

            const hitColorString = this.getZoneColorForAngle(
                attacker,
                targetToken,
                drawConfig,
            );
            const hitColorHex =
                typeof hitColorString === "string"
                    ? parseInt(hitColorString.replace("#", "0x"))
                    : 0x00ff00;

            // --- 1. Defender's Antenna (Drawn on Background) ---
            const defAntennaLengthPx = targetZonePx * projectionRatio;
            const defEndX =
                targetToken.center.x - Math.cos(angle) * defAntennaLengthPx;
            const defEndY =
                targetToken.center.y - Math.sin(angle) * defAntennaLengthPx;

            bgOverlay.lineStyle(3, missColorHex, 0.8);
            bgOverlay.moveTo(targetToken.center.x, targetToken.center.y);
            bgOverlay.lineTo(defEndX, defEndY);

            const shieldSize = 14;
            bgOverlay.lineStyle(4, missColorHex, 1.0);
            bgOverlay.moveTo(
                defEndX + Math.cos(angle + Math.PI / 2) * shieldSize,
                defEndY + Math.sin(angle + Math.PI / 2) * shieldSize,
            );
            bgOverlay.lineTo(
                defEndX + Math.cos(angle - Math.PI / 2) * shieldSize,
                defEndY + Math.sin(angle - Math.PI / 2) * shieldSize,
            );

            // --- 2. Attacker's Antenna (Drawn on Background) ---
            const maxWeaponReachFt = Math.max(...weapons.map((w) => w.reach));
            const maxReachPx = this.ftToPx(maxWeaponReachFt, gridData);
            const attAntennaLengthPx = maxReachPx * projectionRatio;

            const attEndX =
                attacker.center.x + Math.cos(angle) * attAntennaLengthPx;
            const attEndY =
                attacker.center.y + Math.sin(angle) * attAntennaLengthPx;

            bgOverlay.lineStyle(3, missColorHex, 0.8);
            bgOverlay.moveTo(attacker.center.x, attacker.center.y);
            bgOverlay.lineTo(attEndX, attEndY);

            // --- 3. Weapon Chevrons and Labels (Drawn on Foreground) ---
            weapons.forEach((weapon, index) => {
                const weaponReachPx = this.ftToPx(weapon.reach, gridData);

                const isHit = weaponReachPx + targetZonePx >= distance3DPx;
                const color = isHit ? hitColorHex : missColorHex;
                const thickness = isHit ? 6 : 4;
                const size = 12;

                const chevronDistPx = weaponReachPx * projectionRatio;
                const cx = attacker.center.x + Math.cos(angle) * chevronDistPx;
                const cy = attacker.center.y + Math.sin(angle) * chevronDistPx;

                // Draw chevron to fgOverlay
                fgOverlay.lineStyle(thickness, color, 1.0);
                fgOverlay.moveTo(
                    cx - Math.cos(angle - Math.PI / 4) * size,
                    cy - Math.sin(angle - Math.PI / 4) * size,
                );
                fgOverlay.lineTo(cx, cy);
                fgOverlay.lineTo(
                    cx - Math.cos(angle + Math.PI / 4) * size,
                    cy - Math.sin(angle + Math.PI / 4) * size,
                );

                if (weapon.name) {
                    const label = new PIXI.Text(weapon.name, textStyle);

                    const direction = index % 2 === 0 ? -1 : 1;
                    const distance = 20 + Math.floor(index / 2) * 18;
                    const staggeredOffset = direction * distance;

                    label.x =
                        cx + Math.cos(angle - Math.PI / 2) * staggeredOffset;
                    label.y =
                        cy + Math.sin(angle - Math.PI / 2) * staggeredOffset;
                    label.anchor.set(0.5);

                    let textRot = angle;
                    if (textRot > Math.PI / 2 || textRot < -Math.PI / 2) {
                        textRot += Math.PI;
                    }
                    label.rotation = textRot;

                    // Add text to fgOverlay
                    fgOverlay.addChild(label);
                }
            });
        });
    }
}
