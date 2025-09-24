const WEAPONS = ["Candlestick", "Dagger", "Lead Pipe", "Revolver", "Rope", "Wrench", "Poison", "Horseshoe"];
const LOCATIONS = ["Swimming Pools", "Zodiac Room", "Trophy Room", "Infinity Pool", "Observation Deck", "Hidden Cove", "Tennis Courts", "Secret Passage", "Greenhouse"];

// ## UPDATED CHARACTER ROSTER ##
const CHARACTERS = [
    { name: 'Agent Crimson', color: 'red' },
    { name: 'General Gold', color: 'yellow' },
    { name: 'Casper Weiss', color: 'white' },
    { name: 'Beatrix Verdi', color: 'green' },
    { name: 'Mr. Indigo', color: 'blue' },
    { name: 'Violet Vale', color: 'purple' },
    { name: 'Duchess Rosa', color: 'pink' },
    { name: 'Analyst Sterling', color: 'gray' },
    { name: 'Lady Marigold', color: 'orange' },
    { name: 'The Technician', color: 'brown' }
];

const BOARD_LAYOUT = [
    { id: 0, name: "Swimming Pools", type: "room", gridArea: "r1" },
    { id: 1, name: "Zodiac Room", type: "room", gridArea: "r2" },
    { id: 2, name: "Trophy Room", type: "room", gridArea: "r3" },
    { id: 3, name: "Health Tracker", type: "health_tracker", gridArea: "r4" },
    { id: 4, name: "Gather Supplies", type: "supply", gridArea: "p1" },
    { id: 5, name: "Start", type: "start", gridArea: "start" },
    { id: 6, name: "Infinity Pool", type: "room", gridArea: "r5" },
    { id: 7, name: "Observation Deck", type: "room", gridArea: "r6" },
    // { id: 8, name: "", type: "path", gridArea: "p2" },
    { id: 9, name: "Hidden Cove", type: "room", gridArea: "r7" },
    { id: 10, name: "Storm Tracker", type: "storm_tracker", gridArea: "r8" },
    { id: 11, name: "Tennis Courts", type: "room", gridArea: "r9" },
    { id: 12, name: "Secret Passage", type: "room", gridArea: "r10" },
    { id: 13, name: "Greenhouse", type: "room", gridArea: "r11" }
];

const STARTING_POSITION_INDEX = 5;

module.exports = {
    WEAPONS,
    LOCATIONS,
    CHARACTERS,
    BOARD_LAYOUT,
    STARTING_POSITION_INDEX
};