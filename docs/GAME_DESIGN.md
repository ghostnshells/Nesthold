# Nesthold — Game Design

*Clash of Clans meets Clusterduck.* You build and defend a duck **nest** on an isometric grid, hatch specialised ducks, and raid other players' nests alone or with your **flock**. Flock-mates can only talk by **carrier pigeon**, and rivals can intercept those pigeons.

The numbers live in code: `packages/shared/src/data/*.ts`. This doc explains the intent behind them.

## Core loop
1. **Build**: place and upgrade buildings. Construction Ducks are your builder slots.
2. **Produce**: Grain Fields and Feather Looms fill up over time. Tap them to collect into storage (the Nest Core and Granaries).
3. **Hatch**: the Hatchery turns grain and feathers into ducks. It also sets how many combat ducks you can house.
4. **Raid**: attack a bot nest or a player's nest snapshot. Loot comes from the Core and Granaries you destroy.
5. **Flock**: donate ducks, run co-op raids, and send pigeons, while dodging the hawks.

## Resources
| Resource | Source | Used for |
|---|---|---|
| Grain | Grain Fields, raids | Almost everything |
| Feathers | Feather Looms, raids | Upgrades, better ducks, pigeon escorts and armour |
| Shiny Pebbles | Starting stash, 3-star raids | Rushing construction |

## Ducks
**Economy ducks** live at home:
- **Farmer Duck**: +50% on one Grain Field each. You can have at most one per field.
- **Construction Duck**: one concurrent build or upgrade each. You can have up to 1 + Nest Core level, with a maximum of 4.
- **Molting Duck**: +50% on one Feather Loom each.

**Combat ducks** go on raids:
| Duck | Role | Notes |
|---|---|---|
| Mallard Brawler | Cheap melee | Targets the nearest building |
| Eider Tank | Tank | Targets defenses first. **Disciplined** |
| Teal Scout | Fast flyer | Targets resource buildings. Flies over walls. Only the Catapult and the Heron can hit it |
| Merganser Egg-Lobber | Ranged splash | Lobs eggs over walls from 3.5 tiles |
| Sapper Scoter | Wall breaker | Bread-bomb does 12× damage to walls. It dies on use |
| Wood Duck Medic | Healer | Heals ducks within 2.5 tiles. Doesn't attack. **Disciplined** |

Advanced ducks unlock with Hatchery level: Merganser and Eider at L2, Medic at L3.

## Buildings
- **Nest Core**: the town hall. Every other building's level is capped by the Core's level. Destroying the Core earns a star. It stores resources.
- **Grain Field**, **Feather Loom**: producers.
- **Granary**: storage. It holds most of the lootable resources.
- **Hatchery**: trains ducks and provides housing.
- **Reed Wall**: 1×1 wall. Ground ducks path around walls if a gap is cheap, otherwise they chew through.
- **Pigeon Loft**: pigeon speed. L2 adds armour, and L3 adds a cipher.
- **Hawk Perch**: intercepts rival pigeons that fly within range of your nest on the world map.

### Duck-themed weapons
- **Air-Defense Catapult**: long range, hits **airborne ducks only**, splash damage.
- **Birdshot Blaster**: short-range pellet spray, hits **ground ducks only**, splash damage.
- **Heron Watchtower**: long-range single-target sniper that hits ground and air.
- **Snapping Turtle Pit**: hidden one-shot trap with burst damage to ground ducks.

### Distractions
Distractions are deliberately weak, so they buy time but don't win fights on their own.

| Distraction | Trigger | Who | Cap | Duration |
|---|---|---|---|---|
| Feed Scatterer | Any duck within 3 tiles | Any duck, ground or air | 3/4/4 ducks | 3/3.5/4 s |
| Fake Mating-Call Horn | Any duck within 5 tiles | **Non-disciplined** ducks only | 4/5/5 ducks | 2/2.5/3 s |

These rules apply to every distraction, and the sim enforces them in `battle.ts`:
- **Hard ceilings**: one trigger never affects more than **5** ducks, and no distraction lasts more than **4 s**.
- A distracted duck walks to the lure and stops attacking. Defenses keep shooting it.
- When a distraction wears off, the duck is **immune for 3 s**, so distractions can't be chained into a stun-lock.
- Each distraction has 1 charge, or 2 at level 3.

## Battles
- The sim is deterministic and ticks at 10 Hz. The battle lasts up to 3 minutes.
- You deploy by tapping any tile that isn't within one tile of a building. Hidden traps don't block deployment.
- **Stars**: 1 for ≥50% destroyed, 1 for the Nest Core, and 1 for 100%. Walls and traps don't count toward destruction.
- **Loot**: 20% of the defender's stored grain and feathers. It's split between the Core (weight 1) and each Granary (weight 2), and you gain each share when that building falls.
- **Anti-cheat**: the client sends only the list of deploy commands. The server replays them against the same snapshot and seed, then awards the loot the server computed.
- **Asynchronous**: you attack a snapshot of the defender's nest. The defender gets a 10-minute shield and a replayable battle log.
- Every deployed duck is used up, as in Clash of Clans.

## Flocks
- A flock has up to 10 members. The founder is the leader.
- **Donate** combat ducks straight into a flock-mate's hatchery, as long as they have room.
- **Flock Raid**: the leader picks a target, and members pledge ducks for up to 10 minutes. The leader can launch at any time and plays the raid with the pooled army. Loot is split in proportion to how much housing each member pledged.

## Carrier pigeons
Flock-mates can only message each other by pigeon.
- Every nest has a position on a 1000×1000 world map. A pigeon flies in a straight line at a speed set by the Pigeon Loft level (8, 12 or 16 units/s).
- Any Hawk Perch belonging to a player **outside the sender's flock**, whose radius (90, 120 or 150) touches the flight line, gets one seeded interception roll. The chance is the hawk's power (35%, 50% or 65%) minus 15% per point of armour, clamped between 5% and 90%.
- **Escorted pigeon** (costs feathers): the hawk has to win two rolls in a row.
- **Armored pigeon** (costs more feathers): +2 armour.
- Pigeon Loft L2 adds +1 armour to every pigeon. At L3 messages are **enciphered**, so an interceptor reads mostly scrambled text.
- **When a pigeon is intercepted**: the message never arrives. The hawk's owner gets the message, readable or scrambled. The sender gets a "pigeon lost" report when the pigeon would have landed.
- Before sending, the client previews the risk with the same shared code: "2 hawks on this route, 42% chance to arrive".

Hawk Perches create a tactical map. Flocks cluster together, or pay for escorts, and a well-placed rival hawk can reveal a raid plan.

## Bots
The server seeds AI nests at Nest Core levels 1–3, including a bot flock you can join to try out pigeons and flock raids solo. Bot flock-mates answer your pigeons (their replies can be intercepted too) and pledge ducks to raids. Some rival bots own Hawk Perches placed across common routes.
