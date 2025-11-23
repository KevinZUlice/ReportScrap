(function () {
    // --- Helpers ---

    function txt(el) {
        return el ? el.textContent.trim() : "";
    }

    function toInt(str) {
        if (str == null) return null;
        const n = parseInt(String(str).replace(/[^\d-]/g, ""), 10);
        return isNaN(n) ? null : n;
    }

    function toFloat(str) {
        if (str == null) return null;
        const s = String(str).replace(",", ".").replace(/[^\d.-]/g, "");
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    // --- 1) META ---

    const host = window.location.hostname;   // cs104.divokekmeny.cz
    const world = host.split(".")[0] || null;

    let raw_html, raw_text;

    (function () {
        // hlavní tabulka s oznámením – ta úzká uprostřed
        const mainTable = document.querySelector('#content_value table.vis[width="470"]');
        if (mainTable) {
            raw_html = mainTable.outerHTML;
            raw_text = mainTable.innerText.trim();
        } else {
            // fallback
            const content = document.getElementById("content_value");
            if (content) {
                raw_html = content.innerHTML;
                raw_text = content.innerText.trim();
            } else {
                raw_html = document.documentElement.outerHTML;
                raw_text = document.body ? document.body.innerText.trim() : "";
            }
        }
    })();

    let occurred_at = null;
    let occurred_at_raw = null;
    (function () {
        // 22.11.25 23:20:51:701  (DD.MM.YY/ YYYY, s ms)
        const m = raw_text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})(?::\d{1,3})?/);
        if (!m) return;
        occurred_at_raw = m[0];
        let day = parseInt(m[1], 10);
        let month = parseInt(m[2], 10);
        let year = parseInt(m[3], 10);
        const hour = parseInt(m[4], 10);
        const min = parseInt(m[5], 10);
        const sec = parseInt(m[6], 10);

        if (year < 100) year = 2000 + year; // 25 -> 2025

        const d = new Date(year, month - 1, day, hour, min, sec);
        occurred_at = d.toISOString();
    })();

    const source = "script_dk_report_scraper";
    const scraped_at = new Date().toISOString();

    // --- 2) ÚTOČNÍK / OBRÁNCE ---

    function parseSideFromTable(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return null;

        const rows = table.querySelectorAll("tr");
        if (rows.length < 2) return null;

        // 1. řádek: hráč
        // 2. řádek: vesnice
        const playerRow = rows[0];
        const villageRow = rows[1];

        let player = null;
        let ally_tag = null;
        let village_name = null;

        const playerLink = playerRow.querySelector("a");
        if (playerLink) {
            player = txt(playerLink);
            // aliance je v data-title toho linku, ale tam máš název kmene, ne [TAG]
            // ally_tag lze případně doplnit později jiným zdrojem
        }

        const vLink = villageRow.querySelector("a");
        if (vLink) {
            village_name = txt(vLink);
        }

        let x = null, y = null, continent = null;
        const refText = village_name || (villageRow ? txt(villageRow) : "");

        const coordMatch = refText.match(/(\d{3})\|(\d{3})/);
        if (coordMatch) {
            x = parseInt(coordMatch[1], 10);
            y = parseInt(coordMatch[2], 10);
        }
        const kMatch = refText.match(/K(\d{2})/i);
        if (kMatch) continent = parseInt(kMatch[1], 10);

        return {
            player,
            ally_tag,
            village_name,
            x,
            y,
            continent
        };
    }

    const attSide = parseSideFromTable("attack_info_att") || {};
    const defSide = parseSideFromTable("attack_info_def") || {};

    // --- 4) VÝSLEDEK, LUCK, MORALE, NIGHT BONUS, WALL, FAITH, LOYALITA ---

    let luck_percent = null;
    let morale_percent = null;
    let night_bonus = null;
    let wall_before = null;
    let wall_after = null;
    let faith_attacker = null;
    let faith_defender = null;
    let loyalty_before = null;
    let loyalty_after = null;
    let winner_side = null;
    let event_type = "attack";

    // Štěstí z tabulky attack_luck
    (function () {
        const luckNode = document.querySelector("#attack_luck");
        if (luckNode) {
            const m = luckNode.innerText.match(/(-?\d+[.,]?\d*)\s*%/);
            if (m) luck_percent = toFloat(m[1]);
        }
    })();

    // Morálka: fallback regex
    (function () {
        const m = raw_text.match(/Morálka:\s*([\d.,]+)\s*%/i);
        if (m) morale_percent = toFloat(m[1]);
    })();

    // Noční bonus
    (function () {
        if (/Noční bonus/i.test(raw_text)) {
            night_bonus = true;
        } else {
            night_bonus = null;
        }
    })();

    // Hradby – "Hradby poškozeny ze stupně 20 na stupeň 19"
    (function () {
        const m = raw_text.match(/Hradby[^\d]*(\d+)[^\d]+(\d+)/i);
        if (m) {
            wall_before = toInt(m[1]);
            wall_after  = toInt(m[2]);
        }
    })();

    // Víra – první "Víra: Vojsko ..." = útočník, druhá = obránce
    (function () {
        const re = /Víra:\s*Vojsko\s+(nebylo|bylo)\s+věřící\./gi;
        const matches = [];
        let m;
        while ((m = re.exec(raw_text)) !== null) {
            matches.push(m[1].toLowerCase());
        }
        if (matches[0]) {
            faith_attacker = (matches[0] === "bylo");
        }
        if (matches[1]) {
            faith_defender = (matches[1] === "bylo");
        }
    })();

    // Loajalita – pokud se někdy objeví
    (function () {
        const m = raw_text.match(/Loajalita.*?(\d+).*?(\d+)/i);
        if (m) {
            loyalty_before = toInt(m[1]);
            loyalty_after = toInt(m[2]);
            if (loyalty_after === 0) event_type = "conquer";
        }
    })();

    // --- 5) JEDNOTKY ---

    const unitKeyMap = {
        spear: "spear",
        sword: "sword",
        axe: "axe",
        archer: "archer",
        spy: "spy",
        light: "light",
        marcher: "mounted",
        heavy: "heavy",
        ram: "ram",
        catapult: "catapult",
        knight: "paladin",
        snob: "noble",
        // militia ignorujeme (nemáš sloupce)
    };

    function parseUnitsFromTable(tableId, prefix) {
        const table = document.getElementById(tableId);
        const result = {};

        Object.values(unitKeyMap).forEach(key => {
            result[`${prefix}_${key}`] = 0;
            result[`${prefix}_${key}_loss`] = 0;
        });

        if (!table) return result;

        const rows = table.querySelectorAll("tr");
        if (rows.length < 3) return result;

        const headerRow = rows[0];
        const countRow = rows[1];
        const lossRow = rows[2];

        const headers = Array.from(headerRow.querySelectorAll("td,th"));

        headers.forEach((cell, idx) => {
            // v DK je data-unit na <a>, obrázek je .webp
            const a = cell.querySelector("a[data-unit]");
            const img = cell.querySelector("img");
            if (!a && !img) return;

            let rawUnit = a ? a.getAttribute("data-unit") : null;
            if (!rawUnit && img) {
                const src = img.getAttribute("src") || "";
                const m = src.match(/unit_(\w+)\./);
                if (m) rawUnit = m[1];
            }
            if (!rawUnit) return;

            rawUnit = rawUnit.toLowerCase();
            if (!(rawUnit in unitKeyMap)) return; // třeba militia

            const unitKey = unitKeyMap[rawUnit];

            const countCell = countRow.children[idx];
            const lossCell = lossRow.children[idx];

            const count = toInt(countCell ? countCell.textContent : "");
            const loss = toInt(lossCell ? lossCell.textContent : "");

            result[`${prefix}_${unitKey}`] = count || 0;
            result[`${prefix}_${unitKey}_loss`] = loss || 0;
        });

        return result;
    }

    const attUnits = parseUnitsFromTable("attack_info_att_units", "att");
    const defUnits = parseUnitsFromTable("attack_info_def_units", "def");

    // --- 6) KOŘIST ---

    let loot_wood = 0;
    let loot_clay = 0;
    let loot_iron = 0;
    let loot_capacity = null;
    let loot_full = null;

    (function () {
        // 1) Primárně se pokusit najít tabulku #attack_results a v ní řádek s Kořistí
        const lootTable = document.querySelector('#attack_results');
        if (lootTable) {
            // v novém layoutu DK jsou ikonky jako <span class="icon header wood/stone/iron">
            const wraps = lootTable.querySelectorAll('span.nowrap');
            wraps.forEach(wrap => {
                const icon = wrap.querySelector('.icon.header');
                if (!icon) return;

                const cls = icon.className || "";
                const val = toInt(wrap.textContent);

                if (/wood/i.test(cls)) loot_wood = val || 0;
                else if (/stone|lehm|clay/i.test(cls)) loot_clay = val || 0;
                else if (/iron/i.test(cls)) loot_iron = val || 0;
            });
        }

        // 2) Kapacita (pokud je uvedená)
        if (!loot_capacity) {
            const capMatch = raw_text.match(/Náklad\s*:\s*(\d+)\s*\/\s*(\d+)/i);
            if (capMatch) {
                const used = toInt(capMatch[1]);
                const cap = toInt(capMatch[2]);
                loot_capacity = cap;
                loot_full = cap ? +(used / cap * 100).toFixed(2) : null;
            }
        }

        // 3) Fallback – když byla nějaká kořist, ale nenajdeme kapacitu
        if (!loot_capacity && (loot_wood + loot_clay + loot_iron) > 0) {
            loot_capacity = loot_wood + loot_clay + loot_iron;
            loot_full = 100.0;
        }
    })();

    // --- Winner side (heuristika) ---

    (function () {
        const attSurvivors = Object.keys(attUnits)
            .filter(k => !k.endsWith("_loss"))
            .reduce((sum, k) => {
                const base = attUnits[k] || 0;
                const loss = attUnits[`${k}_loss`] || 0;
                return sum + Math.max(base - loss, 0);
            }, 0);

        const defSurvivors = Object.keys(defUnits)
            .filter(k => !k.endsWith("_loss"))
            .reduce((sum, k) => {
                const base = defUnits[k] || 0;
                const loss = defUnits[`${k}_loss`] || 0;
                return sum + Math.max(base - loss, 0);
            }, 0);

        // tady by ideálně měl rozhodovat i text "XY vyhrál", ale zatím nechám heuristiku:
        if (event_type === "conquer") {
            winner_side = "attacker";
        } else if (defSurvivors === 0 && attSurvivors > 0) {
            winner_side = "attacker";
        } else {
            winner_side = "defender";
        }
    })();

    // --- Objekt dat ---

    const data = {
        world,
        occurred_at,
        occurred_at_raw,
        imported_at: scraped_at,
        source,
        raw_html,
        raw_text,

        attacker_player:       attSide.player || null,
        attacker_ally_tag:     attSide.ally_tag || null,
        attacker_village_name: attSide.village_name || null,
        attacker_x:            attSide.x,
        attacker_y:            attSide.y,
        attacker_continent:    attSide.continent,

        defender_player:       defSide.player || null,
        defender_ally_tag:     defSide.ally_tag || null,
        defender_village_name: defSide.village_name || null,
        defender_x:            defSide.x,
        defender_y:           defSide.y,
        defender_continent:    defSide.continent,

        winner_side,
        event_type,
        luck_percent,
        morale_percent,
        night_bonus,
        wall_before,
        wall_after,
        faith_attacker,
        faith_defender,

        // attacker units
        att_spear:        attUnits.att_spear || 0,
        att_spear_loss:   attUnits.att_spear_loss || 0,
        att_sword:        attUnits.att_sword || 0,
        att_sword_loss:   attUnits.att_sword_loss || 0,
        att_axe:          attUnits.att_axe || 0,
        att_axe_loss:     attUnits.att_axe_loss || 0,
        att_archer:       attUnits.att_archer || 0,
        att_archer_loss:  attUnits.att_archer_loss || 0,
        att_spy:          attUnits.att_spy || 0,
        att_spy_loss:     attUnits.att_spy_loss || 0,
        att_light:        attUnits.att_light || 0,
        att_light_loss:   attUnits.att_light_loss || 0,
        att_mounted:      attUnits.att_mounted || 0,
        att_mounted_loss: attUnits.att_mounted_loss || 0,
        att_heavy:        attUnits.att_heavy || 0,
        att_heavy_loss:   attUnits.att_heavy_loss || 0,
        att_ram:          attUnits.att_ram || 0,
        att_ram_loss:     attUnits.att_ram_loss || 0,
        att_catapult:     attUnits.att_catapult || 0,
        att_catapult_loss:attUnits.att_catapult_loss || 0,
        att_paladin:      attUnits.att_paladin || 0,
        att_paladin_loss: attUnits.att_paladin_loss || 0,
        att_noble:        attUnits.att_noble || 0,
        att_noble_loss:   attUnits.att_noble_loss || 0,

        // defender units
        def_spear:        defUnits.def_spear || 0,
        def_spear_loss:   defUnits.def_spear_loss || 0,
        def_sword:        defUnits.def_sword || 0,
        def_sword_loss:   defUnits.def_sword_loss || 0,
        def_axe:          defUnits.def_axe || 0,
        def_axe_loss:     defUnits.def_axe_loss || 0,
        def_archer:       defUnits.def_archer || 0,
        def_archer_loss:  defUnits.def_archer_loss || 0,
        def_spy:          defUnits.def_spy || 0,
        def_spy_loss:     defUnits.def_spy_loss || 0,
        def_light:        defUnits.def_light || 0,
        def_light_loss:   defUnits.def_light_loss || 0,
        def_mounted:      defUnits.def_mounted || 0,
        def_mounted_loss: defUnits.def_mounted_loss || 0,
        def_heavy:        defUnits.def_heavy || 0,
        def_heavy_loss:   defUnits.def_heavy_loss || 0,
        def_ram:          defUnits.def_ram || 0,
        def_ram_loss:     defUnits.def_ram_loss || 0,
        def_catapult:     defUnits.def_catapult || 0,
        def_catapult_loss:defUnits.def_catapult_loss || 0,
        def_paladin:      defUnits.def_paladin || 0,
        def_paladin_loss: defUnits.def_paladin_loss || 0,
        def_noble:        defUnits.def_noble || 0,
        def_noble_loss:   defUnits.def_noble_loss || 0,

        loot_wood,
        loot_clay,
        loot_iron,
        loot_capacity,
        loot_full,
        loyalty_before,
        loyalty_after
    };

    // --- Pořadí klíčů pro výstup ---

    const keyOrder = [
        "world",
        "occurred_at",
        "occurred_at_raw",
        "imported_at",
        "source",
        "raw_html",
        "raw_text",

        "attacker_player",
        "attacker_ally_tag",
        "attacker_village_name",
        "attacker_x",
        "attacker_y",
        "attacker_continent",

        "defender_player",
        "defender_ally_tag",
        "defender_village_name",
        "defender_x",
        "defender_y",
        "defender_continent",

        "winner_side",
        "event_type",
        "luck_percent",
        "morale_percent",
        "night_bonus",
        "wall_before",
        "wall_after",
        "faith_attacker",
        "faith_defender",

        "att_spear","att_spear_loss",
        "att_sword","att_sword_loss",
        "att_axe","att_axe_loss",
        "att_archer","att_archer_loss",
        "att_spy","att_spy_loss",
        "att_light","att_light_loss",
        "att_mounted","att_mounted_loss",
        "att_heavy","att_heavy_loss",
        "att_ram","att_ram_loss",
        "att_catapult","att_catapult_loss",
        "att_paladin","att_paladin_loss",
        "att_noble","att_noble_loss",

        "def_spear","def_spear_loss",
        "def_sword","def_sword_loss",
        "def_axe","def_axe_loss",
        "def_archer","def_archer_loss",
        "def_spy","def_spy_loss",
        "def_light","def_light_loss",
        "def_mounted","def_mounted_loss",
        "def_heavy","def_heavy_loss",
        "def_ram","def_ram_loss",
        "def_catapult","def_catapult_loss",
        "def_paladin","def_paladin_loss",
        "def_noble","def_noble_loss",

        "loot_wood",
        "loot_clay",
        "loot_iron",
        "loot_capacity",
        "loot_full",
        "loyalty_before",
        "loyalty_after"
    ];

    const lines = keyOrder.map(key => {
        const val = (key in data) ? data[key] : null;
        return key + " = " + JSON.stringify(val);
    });

    const outputText = lines.join("\n");

    // --- Okno s výstupem ---

    (function showWindow(text) {
        const wrapper = document.createElement("div");
        wrapper.style.position = "fixed";
        wrapper.style.top = "50%";
        wrapper.style.left = "50%";
        wrapper.style.transform = "translate(-50%, -50%)";
        wrapper.style.zIndex = "99999";
        wrapper.style.background = "#f4e4bc";
        wrapper.style.border = "2px solid #804000";
        wrapper.style.padding = "10px";
        wrapper.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
        wrapper.style.maxWidth = "80%";
        wrapper.style.maxHeight = "70%";

        const title = document.createElement("div");
        title.textContent = "DK report → key = value";
        title.style.fontWeight = "bold";
        title.style.marginBottom = "5px";
        wrapper.appendChild(title);

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.width = "800px";
        textarea.style.height = "400px";
        textarea.style.maxWidth = "100%";
        textarea.style.maxHeight = "calc(100% - 60px)";
        textarea.style.fontFamily = "monospace";
        wrapper.appendChild(textarea);

        const btnRow = document.createElement("div");
        btnRow.style.marginTop = "5px";

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Kopírovat";
        copyBtn.onclick = () => {
            textarea.select();
            document.execCommand("copy");
        };
        btnRow.appendChild(copyBtn);

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Zavřít";
        closeBtn.style.marginLeft = "10px";
        closeBtn.onclick = () => wrapper.remove();
        btnRow.appendChild(closeBtn);

        wrapper.appendChild(btnRow);
        document.body.appendChild(wrapper);
        textarea.select();
    })(outputText);

})();

