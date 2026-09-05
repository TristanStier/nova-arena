/* 11c_upgrade_text.js — NA.UpgradeText: the player-facing name and one-line
 * per-tier description of every upgrade in the registry.
 *
 * Pure data. No dependency on NA.Upgrades (it may not be loaded yet), no
 * gameplay effect: the draft overlay in src/15_ui.js is the only consumer.
 *
 *   NA.UpgradeText.table          { id: { name, tiers:[t1, t2, t3] } }
 *   NA.UpgradeText.nameOf(id)     -> 'Twin Barrels'  (Title Case of the id if
 *                                    the id is not in the table)
 *   NA.UpgradeText.descOf(id, t)  -> the 1-based tier's line, '' if unknown
 *
 * The 42 ids below are exactly the canonical upgrade ids (AGENT_RULES §8) and
 * the descriptions are distilled from the per-tier notes in src/11_upgrades.js
 * and src/11b_upgrades_b.js. Keep every line <= ~70 characters: the draft
 * wraps to at most three lines under the card.
 */
(function () {
  var TABLE = {
    /* ---------------------------------------------------------- weapons */
    twinBarrels: {
      name: 'Twin Barrels',
      tiers: [
        'Fires two parallel bullets at 75% damage.',
        'The barrels converge, crossing at your cursor.',
        'A weaker rear pair fires out behind you.'
      ]
    },
    railgun: {
      name: 'Railgun',
      tiers: [
        'Hold fire to charge a piercing beam; the primary stops.',
        'The shot leaves a rail that burns anything crossing it.',
        'A full charge fires a V and drags everything between in.'
      ]
    },
    buckshot: {
      name: 'Buckshot',
      tiers: [
        'Fires a five-pellet cone.',
        'Spent pellets hang as sparks, then fall back to you.',
        'A point-blank kill racks the slide: one free shot.'
      ]
    },
    mortar: {
      name: 'Mortar',
      tiers: [
        'Every fourth shot lobs a shell that bursts at your cursor.',
        'The shell splits into three at the top of its arc.',
        'Shells leave a crater: slower enemies, +40% damage taken.'
      ]
    },
    gatling: {
      name: 'Gatling',
      tiers: [
        'Holding the trigger spins your fire rate up to 3x.',
        'At full spin your bullets set enemies on fire.',
        'At full spin your mana trickle doubles.'
      ]
    },

    /* ------------------------------------------------------ projectiles */
    blast: {
      name: 'Blast',
      tiers: [
        'Your bullets explode on hit.',
        'An explosion kill sets off another, up to four times.',
        'Explosions shove; enemies slammed into things take damage.'
      ]
    },
    ricochet: {
      name: 'Ricochet',
      tiers: [
        'Bullets bounce off the arena walls once.',
        'Bullets also bounce off enemies into the nearest other.',
        'Each bounce adds +25% damage and one more bounce, max six.'
      ]
    },
    drill: {
      name: 'Drill',
      tiers: [
        'Bullets pierce through two enemies.',
        'Every pierce makes the bullet faster and longer.',
        'A pierce kill carries the corpse as a brief shield.'
      ]
    },
    seeker: {
      name: 'Seeker',
      tiers: [
        'Your bullets curve gently toward enemies.',
        'A bullet that misses turns around for a second pass.',
        'A bullet that hits splits into two seekers at half damage.'
      ]
    },
    voltaic: {
      name: 'Voltaic',
      tiers: [
        'Every third hit arcs lightning to a nearby enemy.',
        'Arcs chain through up to five enemies with no falloff.',
        'Struck enemies take +30% damage and burst on death.'
      ]
    },

    /* ---------------------------------------------------------- actives */
    overdrive: {
      name: 'Overdrive',
      tiers: [
        'Hold to drain 12 mana a second and fire twice as fast.',
        'Overdrive bullets hit 30% harder and refund near misses.',
        'Releasing after two seconds dumps a full-circle nova.'
      ]
    },
    chrono: {
      name: 'Chrono',
      tiers: [
        'Hold to slow the world to 30% for 20 mana a second.',
        'Bullets fired while slowed freeze, then all launch at once.',
        'Enemies hit while slowed rewind and take the damage twice.'
      ]
    },
    pulse: {
      name: 'Pulse',
      tiers: [
        '30 mana: a shockwave that erases enemy fire and knocks back.',
        'The bullets the wave erases come back as yours.',
        'Hold to charge for 2.5x radius, and it stuns.'
      ]
    },

    /* ------------------------------------------------------------- mana */
    siphon: {
      name: 'Siphon',
      tiers: [
        'Kills close to you refund an extra 5 mana.',
        'Damage you take refunds double its cost as mana.',
        'At empty you can overspend; your hull pays the difference.'
      ]
    },
    overcharge: {
      name: 'Overcharge',
      tiers: [
        'Your mana bar overfills up to 150.',
        'Above 100 mana your bullets turn gold and hit 50% harder.',
        'Reaching 150 unleashes a screen-wide lightning storm.'
      ]
    },
    arcane: {
      name: 'Arcane',
      tiers: [
        'Bullets cost half a mana each and hit 60% harder.',
        'An arcane kill refunds triple what the shot cost.',
        'Arcane bullets pass straight through walls.'
      ]
    },

    /* ------------------------------------------------------- mobility */
    afterburner: {
      name: 'Afterburner',
      tiers: [
        'Dashing through enemies hurts them and keeps your speed.',
        'Chain dashes: the second is cheap and long, the third free.',
        'You land in a ring that erases enemy bullets.'
      ]
    },
    phase: {
      name: 'Phase',
      tiers: [
        'Your dash erases every enemy bullet in its path.',
        'Erased bullets are stored and re-fired on your next shot.',
        'You can dash straight through walls.'
      ]
    },
    drift: {
      name: 'Drift',
      tiers: [
        'Icy momentum and +40% top speed; braking costs 3 mana.',
        'Sliding sideways lays a burning skid trail.',
        'Hitting a wall fast bounces you, with a shockwave.'
      ]
    },
    blink: {
      name: 'Blink',
      tiers: [
        'Teleport to your cursor for 25 mana; replaces the dash.',
        'You leave a decoy behind that lures, then detonates.',
        'Blinking onto an enemy swaps places with it.'
      ]
    },

    /* ------------------------------------------------------- defensive */
    hullPlating: {
      name: 'Hull Plating',
      tiers: [
        'One more hull point, at the cost of 8% of your speed.',
        'When the plate is knocked off it flies away as a heavy shot.',
        'While the plate is gone you fire faster and gain mana.'
      ]
    },
    vent: {
      name: 'Vent',
      tiers: [
        'At one hull point, your whole mana bar erupts as a pulse.',
        'Any hit while holding 60+ mana vents it on the spot.',
        'The vent leaves a bubble that enemy bullets crawl through.'
      ]
    },
    ghost: {
      name: 'Ghost',
      tiers: [
        'A wisp recharges every 8 seconds and eats one hit.',
        'Spending the wisp makes you untouchable and lethal for 1s.',
        'Ten kills in three seconds relights the wisp at once.'
      ]
    },

    /* --------------------------------------------------------- triggers */
    reaper: {
      name: 'Reaper',
      tiers: [
        'Every corpse fires one last shot at whatever is nearest.',
        'Kills drop souls; each is +2% damage for the wave, up to 60%.',
        'Every tenth kill raises the corpse as your ally for 5s.'
      ]
    },
    impact: {
      name: 'Impact',
      tiers: [
        'Five hits on the same enemy and the fifth deals triple.',
        'Crits mark an enemy; it also takes 5% of all damage you deal.',
        'Killing a marked enemy throws the mark to two others.'
      ]
    },
    wake: {
      name: 'Wake',
      tiers: [
        'Every dash sprays six rounds back out of your exhaust.',
        'The spot you dashed from is left holding a mine.',
        'Your landing sets off a free, smaller pulse.'
      ]
    },
    spendthrift: {
      name: 'Spendthrift',
      tiers: [
        'Every 25 mana you spend throws a heavy homing bolt.',
        'Every 100 spent gives one second of tenfold mana trickle.',
        'Spending while nearly empty counts double.'
      ]
    },
    overkill: {
      name: 'Overkill',
      tiers: [
        'Damage a kill wasted carries on into the next enemy.',
        'A big overkill bursts the body into three shards.',
        'Overkill is banked; at 500 your next shot fires as a rail.'
      ]
    },

    /* ----------------------------------------------------------- summons */
    shardOrbit: {
      name: 'Shard Orbit',
      tiers: [
        'Two crystals orbit you and cut whatever they touch.',
        'Kills add temporary shards to the ring, up to eight.',
        '10 mana throws every shard out as a piercing boomerang.'
      ]
    },
    drone: {
      name: 'Drone',
      tiers: [
        'A wingman follows you and fires a weak copy of your gun.',
        'The drone inherits every bullet upgrade you own.',
        'A second drone joins, and both dash when you do.'
      ]
    },
    turret: {
      name: 'Turret',
      tiers: [
        '20 mana bolts a turret to the floor for ten seconds.',
        'Two turrets close together string a cutting laser between them.',
        'Three turrets at once, and each explodes when its time is up.'
      ]
    },
    mirror: {
      name: 'Mirror',
      tiers: [
        'A translucent twin beside you fires at half strength.',
        'The twin copies you half a second late instead of offset.',
        'Two twins, held at either side of you.'
      ]
    },

    /* ------------------------------------------------------------- zones */
    mines: {
      name: 'Mines',
      tiers: [
        'A mine drops behind you every two seconds, twelve at a time.',
        'Mines wake up and crawl toward the nearest enemy.',
        'One blast lights a fuse into every mine near it.'
      ]
    },
    stormCloud: {
      name: 'Storm Cloud',
      tiers: [
        'A drifting cloud slows enemies and gnaws at them.',
        'The cloud follows your cursor and splits shots fired through it.',
        'The cloud fires lightning into the field twice a second.'
      ]
    },
    gravityWell: {
      name: 'Gravity Well',
      tiers: [
        '35 mana opens a well that hauls in enemies and their fire.',
        'Your rounds slingshot around the rim and leave twice as fast.',
        'The collapse damages everything caught inside.'
      ]
    },
    burnTrail: {
      name: 'Burn Trail',
      tiers: [
        'Your exhaust trail is hot and sets enemies alight.',
        'A dash ignites the whole trail into a wall of fire.',
        'Anything that dies burning leaves a pool of fire behind.'
      ]
    },

    /* ---------------------------------------------------------- wildcards */
    ghostRounds: {
      name: 'Ghost Rounds',
      tiers: [
        'Your bullets are invisible, and hit twice as hard.',
        'Enemies you hit never flinch, so nothing gives you away.',
        'Rounds flicker into view as they pass enemy fire.'
      ]
    },
    claustrophobia: {
      name: 'Claustrophobia',
      tiers: [
        'The arena shrinks 20%; being crowded makes you hit 25% harder.',
        'Another 20% smaller, and the walls grind enemies touching them.',
        'Half an arena, and the walls punch inward every five seconds.'
      ]
    },
    glassHull: {
      name: 'Glass Hull',
      tiers: [
        'One hull point, +80% damage and +50% mana trickle.',
        'With 50 mana banked, a hit drains the bar, not the hull.',
        'Every wave you finish untouched is +10% damage for the run.'
      ]
    },
    berserk: {
      name: 'Berserk',
      tiers: [
        'The emptier your mana, the harder you hit; actives cost more.',
        'Below 20 mana you move and fire half again as fast.',
        'At zero mana the dash is free, but costs a hull point.'
      ]
    },
    feedbackLoop: {
      name: 'Feedback Loop',
      tiers: [
        'Everything on the field fires 30% more; grazes pay double.',
        'Your rounds swallow enemy rounds they touch, +10% damage each.',
        'Half the shots that would have hit you leave again as yours.'
      ]
    },
    gambler: {
      name: 'Gambler',
      tiers: [
        "Every tenth shot comes out of somebody else's gun.",
        "One kill in twenty lends you a tier 1 you don't own, for a wave.",
        'Each wave one upgrade you own glitches up a tier for that wave.'
      ]
    }
  };

  function titleCase(id) {
    if (!id) return '';
    var s = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  NA.UpgradeText = {
    table: TABLE,
    nameOf: function (id) {
      var e = TABLE[id];
      return (e && e.name) || titleCase(id);
    },
    /* tier is 1-based; returns '' for an unknown id or an out-of-range tier. */
    descOf: function (id, tier) {
      var e = TABLE[id];
      if (!e || !e.tiers) return '';
      var t = (tier | 0) - 1;
      if (t < 0) t = 0;
      return e.tiers[t] || '';
    }
  };
})();
